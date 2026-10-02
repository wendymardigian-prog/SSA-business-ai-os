"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { sniffMime } from "@/lib/content/media";
import { CHAT_MEDIA_BUCKET, MAX_CHAT_UPLOAD_BYTES, extensionForMime } from "@/lib/chat-media/bucket";
import { scheduleJob } from "@/lib/scheduler";
import { TRANSCRIBE_AUDIO_JOB, transcribeAssetDedupeKey } from "@/lib/jobs/handlers/transcribe-audio";
import { copyAssetToChat, type AssetChatCopy } from "@/lib/response-assets/send-copy";
import { usedVariables } from "@/lib/templates/interpolate";
import type { AssetKind } from "@/lib/response-assets/kind";

/**
 * La banca de recursos: textos (F17) y audios (F20) en una sola tabla,
 * distinguidos por `kind`. Fusiona lo que antes eran dos acciones separadas,
 * una por plantillas de texto y otra por la biblioteca de audios.
 *
 * Permisos: los ve y los usa cualquier miembro (el selector "/" de la bandeja
 * los necesita), los gestionan Owner y Admin. La regla vive en la RLS
 * (migracion 00105) y se repite aca para poder devolver un mensaje claro en
 * vez de un silencioso "0 filas afectadas".
 *
 * El `kind` no se cambia despues de crear: convertir un texto en audio no es
 * editar, es crear otra cosa. Por eso `updateAsset` lee el `kind` de la fila
 * existente en vez de recibirlo, y no lo toca.
 *
 * Borrado logico: el recurso desaparece de las listas y a los 30 dias lo
 * purga el cron (`purge_soft_deleted`, 00106).
 */

const MAX_NAME = 80;
const MAX_CONTENT = 5000;
const MAX_DESCRIPTION = 500;
const MAX_SHORTCUT = 30;
const MAX_TAGS = 20;

const SHORTCUT_FORMAT = /^\/[a-z0-9][a-z0-9_-]{0,29}$/;

const LIST_PATH = "/dashboard/settings/recursos";

export type AssetActionResult =
  | { ok: true; assetId?: string }
  | { ok: false; error: string };

export interface AssetUploadTicket {
  path: string;
  mime: string;
  token: string;
}

export interface CreateTextAssetInput {
  kind: "text";
  name: string;
  shortcut?: string | null;
  description?: string | null;
  tags?: string[];
  content: string;
}

export interface CreateAudioAssetInput {
  kind: "audio";
  name: string;
  shortcut?: string | null;
  description: string;
  tags?: string[];
  storagePath: string;
  mimeType: string;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
  source: "recorded" | "uploaded";
}

export type CreateAssetInput = CreateTextAssetInput | CreateAudioAssetInput;

export interface UpdateAssetInput {
  name: string;
  shortcut?: string | null;
  description?: string | null;
  tags?: string[];
  /** Solo si el recurso es kind='text'. */
  content?: string;
  agentEnabled?: boolean;
  isActive?: boolean;
  /** Solo si el recurso es kind='audio' y se reemplazo el archivo: dispara una nueva transcripcion y descarta la anterior. */
  replacement?: { storagePath: string; mimeType: string; durationSeconds?: number | null; sizeBytes?: number | null };
}

/**
 * Deja el atajo como se guarda: minusculas, sin espacios y con una sola barra
 * adelante. Devuelve null cuando el campo vino vacio, que es valido.
 */
function normalizeShortcut(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** El error del indice unico de la 00105 dicho en castellano. Es unico ENTRE los dos tipos. */
function describeError(message: string | undefined): string {
  if (message?.includes("idx_response_assets_shortcut") || message?.includes("duplicate key")) {
    return "Ya hay un recurso con ese atajo. Elegí uno distinto.";
  }
  return message ?? "error desconocido";
}

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

function validateName(raw: string): FieldResult<string> {
  const name = (raw ?? "").trim();
  if (!name) return { ok: false, error: "Poné un nombre para el recurso" };
  if (name.length > MAX_NAME) return { ok: false, error: `El nombre es muy largo (máximo ${MAX_NAME} caracteres)` };
  return { ok: true, value: name };
}

function validateShortcut(raw: string | null | undefined): FieldResult<string | null> {
  const shortcut = normalizeShortcut(raw);
  if (!shortcut) return { ok: true, value: null };
  if (shortcut.length > MAX_SHORTCUT + 1) {
    return { ok: false, error: `El atajo es muy largo (máximo ${MAX_SHORTCUT} caracteres)` };
  }
  if (!SHORTCUT_FORMAT.test(shortcut)) {
    return { ok: false, error: "El atajo solo puede tener letras, números, guiones y guiones bajos. Por ejemplo: /precio" };
  }
  return { ok: true, value: shortcut };
}

/** `required` es true para un audio (la IA la necesita), opcional para un texto. */
function validateDescription(raw: string | null | undefined, required: boolean): FieldResult<string | null> {
  const description = (raw ?? "").trim();
  if (!description) {
    if (required) {
      return { ok: false, error: "La descripción es obligatoria: es lo que la IA lee para decidir cuándo usar este audio" };
    }
    return { ok: true, value: null };
  }
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, error: `La descripción es muy larga (máximo ${MAX_DESCRIPTION} caracteres)` };
  }
  return { ok: true, value: description };
}

/** Solo kind='text'. Una variable inventada no rompe nada, pero casi siempre es un error de tipeo. */
function validateContent(raw: string): FieldResult<string> {
  const content = (raw ?? "").trim();
  if (!content) return { ok: false, error: "El texto no puede quedar vacío" };
  if (content.length > MAX_CONTENT) return { ok: false, error: `El texto es muy largo (máximo ${MAX_CONTENT} caracteres)` };

  const { unknown } = usedVariables(content);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Esta variable no existe: {{${unknown[0]}}}. Usá el listado de variables disponibles.`,
    };
  }
  return { ok: true, value: content };
}

/** Recorta, descarta vacias y duplicadas, y respeta el tope de la base (response_assets_tags_sane). */
function validateTags(raw: string[] | undefined): FieldResult<string[]> {
  const tags = Array.from(new Set((raw ?? []).map((t) => t.trim()).filter(Boolean)));
  if (tags.length > MAX_TAGS) return { ok: false, error: `Como mucho ${MAX_TAGS} etiquetas por recurso` };
  return { ok: true, value: tags };
}

/** Autoriza la subida de un audio a la banca. Solo Owner/Admin: mismo guardia que el resto de esta accion. */
export async function requestAssetUpload(input: {
  sizeBytes: number;
  headBase64: string;
  declaredMime?: string;
}): Promise<{ ok: true; ticket: AssetUploadTicket } | { ok: false; error: string }> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden administrar la banca de recursos" };

  if (input.sizeBytes <= 0) return { ok: false, error: "El archivo está vacío" };
  if (input.sizeBytes > MAX_CHAT_UPLOAD_BYTES) {
    const mb = (input.sizeBytes / (1024 * 1024)).toFixed(1);
    return { ok: false, error: `El archivo pesa ${mb} MB y el máximo es 16 MB` };
  }

  const mime = sniffMime(new Uint8Array(Buffer.from(input.headBase64, "base64")));
  if (!mime || !mime.startsWith("audio/")) {
    return { ok: false, error: "Ese archivo no es un audio reconocible" };
  }

  const path = `${ctx.workspace.id}/library/${randomUUID()}.${extensionForMime(mime)}`;
  const service = await createServiceClient();
  const { data, error } = await service.storage.from(CHAT_MEDIA_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[response-assets] no pude firmar la subida:", error?.message);
    return { ok: false, error: "No pude preparar la subida" };
  }

  return { ok: true, ticket: { path, mime, token: data.token } };
}

/** Encola la transcripcion, igual que afterMediaStored para un mensaje (F7). Solo para kind='audio'. */
async function enqueueTranscription(supabase: Awaited<ReturnType<typeof createServiceClient>>, assetId: string): Promise<void> {
  try {
    await scheduleJob(supabase, TRANSCRIBE_AUDIO_JOB, { assetId }, new Date(), transcribeAssetDedupeKey(assetId));
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "23505") {
      console.error("[response-assets] no pude encolar la transcripcion:", err instanceof Error ? err.message : err);
    }
  }
}

export async function createAsset(input: CreateAssetInput): Promise<AssetActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden crear recursos" };

  const { workspace, supabase, user } = ctx;

  const name = validateName(input.name);
  if (!name.ok) return name;
  const shortcut = validateShortcut(input.shortcut);
  if (!shortcut.ok) return shortcut;
  const tags = validateTags(input.tags);
  if (!tags.ok) return tags;

  type AssetInsertValues =
    | { kind: "text"; name: string; shortcut: string | null; description: string | null; tags: string[]; content: string }
    | {
        kind: "audio";
        name: string;
        shortcut: string | null;
        description: string;
        tags: string[];
        storage_path: string;
        mime_type: string;
        duration_seconds: number | null;
        size_bytes: number | null;
        source: "recorded" | "uploaded" | "synthesized";
      };

  let insertValues: AssetInsertValues;

  if (input.kind === "text") {
    const description = validateDescription(input.description, false);
    if (!description.ok) return description;
    const content = validateContent(input.content);
    if (!content.ok) return content;

    insertValues = {
      kind: "text",
      name: name.value,
      shortcut: shortcut.value,
      description: description.value,
      tags: tags.value,
      content: content.value,
    };
  } else {
    const description = validateDescription(input.description, true);
    if (!description.ok) return description;

    insertValues = {
      kind: "audio",
      name: name.value,
      shortcut: shortcut.value,
      // required=true en validateDescription: si llego aca, no es null.
      description: description.value as string,
      tags: tags.value,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      duration_seconds: input.durationSeconds ?? null,
      size_bytes: input.sizeBytes ?? null,
      source: input.source,
    };
  }

  const { data, error } = await supabase
    .from("response_assets")
    .insert({ workspace_id: workspace.id, ...insertValues, created_by: user.id })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[response-assets] alta fallida:", error?.message);
    return { ok: false, error: `No pude crear el recurso: ${describeError(error?.message)}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "response_asset", entityId: data.id,
    action: "create", metadata: { name: name.value, kind: input.kind }, performedBy: user.id,
  });

  if (input.kind === "audio") {
    const service = await createServiceClient();
    await enqueueTranscription(service, data.id);
  }

  revalidatePath(LIST_PATH);
  return { ok: true, assetId: data.id };
}

export async function updateAsset(assetId: string, input: UpdateAssetInput): Promise<AssetActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden editar recursos" };

  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("response_assets")
    .select("id, kind, name, description, shortcut, tags, content, storage_path, agent_enabled, is_active")
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontré ese recurso" };

  const kind = before.kind as AssetKind;
  // Se saca una copia antes de armar el patch: el objeto de arriba viene tal
  // cual lo devolvio la base, y diffFields (y el borrado del archivo viejo,
  // mas abajo) necesitan el valor de ANTES de la edicion.
  const beforeSnapshot = { ...before };
  const oldStoragePath = before.storage_path;

  const name = validateName(input.name);
  if (!name.ok) return name;
  const shortcut = validateShortcut(input.shortcut);
  if (!shortcut.ok) return shortcut;
  const tags = validateTags(input.tags);
  if (!tags.ok) return tags;
  const description = validateDescription(input.description, kind === "audio");
  if (!description.ok) return description;

  const patch: Record<string, unknown> = {
    name: name.value,
    shortcut: shortcut.value,
    description: description.value,
    tags: tags.value,
    ...(input.agentEnabled !== undefined ? { agent_enabled: input.agentEnabled } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
  };

  if (kind === "text") {
    const content = validateContent(input.content ?? "");
    if (!content.ok) return content;
    patch.content = content.value;
  } else if (input.replacement) {
    patch.storage_path = input.replacement.storagePath;
    patch.mime_type = input.replacement.mimeType;
    patch.duration_seconds = input.replacement.durationSeconds ?? null;
    patch.size_bytes = input.replacement.sizeBytes ?? null;
    // Se descarta la transcripcion anterior: el archivo nuevo dice otra cosa.
    patch.transcript = null;
    patch.transcript_status = "none";
    patch.transcript_error = null;
    patch.transcript_source = "auto";
  }

  const { error } = await supabase
    .from("response_assets")
    .update(patch)
    .eq("id", assetId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[response-assets] edicion fallida:", error.message);
    return { ok: false, error: `No pude guardar el recurso: ${describeError(error.message)}` };
  }

  const changes = diffFields(beforeSnapshot, patch);
  if (changes) {
    await logAudit({
      supabase, workspaceId: workspace.id, entityType: "response_asset", entityId: assetId,
      action: "update", changes, performedBy: user.id,
    });
  }

  if (kind === "audio" && input.replacement) {
    const service = await createServiceClient();
    await enqueueTranscription(service, assetId);

    // El archivo VIEJO ya no lo referencia nadie (la fila apunta al nuevo, y
    // una conversacion que lo mando se quedo con su propia COPIA,
    // lib/response-assets/send-copy.ts): se borra en el momento. El bucket
    // no tiene policies de escritura, asi que esto es con el service client.
    // Si falla, no se reintenta aca: lib/response-assets/cleanup.ts es la
    // red de seguridad a los 28 dias.
    if (oldStoragePath && oldStoragePath !== input.replacement.storagePath) {
      const { error: storageError } = await service.storage.from(CHAT_MEDIA_BUCKET).remove([oldStoragePath]);
      if (storageError) {
        console.error("[response-assets] no pude borrar el archivo viejo del bucket:", storageError.message);
      }
    }
  }

  revalidatePath(LIST_PATH);
  return { ok: true, assetId };
}

/** Borrado logico: el recurso deja de aparecer y a los 30 dias se purga. */
export async function deleteAsset(assetId: string): Promise<AssetActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden eliminar recursos" };

  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("response_assets")
    .select("id, name, kind, storage_path")
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontré ese recurso" };

  const { error } = await supabase
    .from("response_assets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[response-assets] borrado fallido:", error.message);
    return { ok: false, error: `No pude eliminar el recurso: ${error.message}` };
  }

  // Nadie mas referencia el archivo de un audio (una conversacion que lo
  // mando se quedo con su propia COPIA, lib/response-assets/send-copy.ts):
  // se borra en el momento, con el service client porque el bucket no tiene
  // policies de escritura. Si falla, no se reintenta aca:
  // lib/response-assets/cleanup.ts es la red de seguridad a los 28 dias.
  if (before.kind === "audio" && before.storage_path) {
    const service = await createServiceClient();
    const { error: storageError } = await service.storage.from(CHAT_MEDIA_BUCKET).remove([before.storage_path]);
    if (storageError) {
      console.error("[response-assets] no pude borrar el archivo del bucket:", storageError.message);
    }
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "response_asset", entityId: assetId,
    action: "delete", metadata: { name: before.name, kind: before.kind }, performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, assetId };
}

/** Corrige la transcripcion a mano: un audio mal transcripto le miente al agente. Solo kind='audio'. */
export async function correctTranscript(assetId: string, text: string): Promise<AssetActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden corregir la transcripción" };

  const { workspace, supabase, user } = ctx;
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "La transcripción no puede quedar vacía" };

  const { data: before } = await supabase
    .from("response_assets")
    .select("id, kind, transcript")
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontré ese recurso" };
  if (before.kind !== "audio") return { ok: false, error: "Solo un audio tiene transcripción" };
  const oldTranscript = before.transcript;

  const { error } = await supabase
    .from("response_assets")
    .update({ transcript: trimmed, transcript_status: "ready", transcript_error: null, transcript_source: "manual" })
    .eq("id", assetId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[response-assets] correccion fallida:", error.message);
    return { ok: false, error: `No pude guardar la corrección: ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "response_asset", entityId: assetId,
    action: "update", changes: { transcript: { old: oldTranscript, new: trimmed } }, performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, assetId };
}

/** La banca completa, para la pantalla de administracion. */
export async function listAssets() {
  const { workspace, supabase } = await getWorkspace();

  const { data, error } = await supabase
    .from("response_assets")
    .select(
      "id, kind, name, shortcut, description, tags, content, storage_path, mime_type, duration_seconds, transcript, transcript_status, agent_enabled, is_active, source",
    )
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("name");

  if (error) {
    console.error("[response-assets] listado fallido:", error.message);
    return [];
  }

  return data ?? [];
}

/**
 * Prepara el envio de un audio de la banca desde el picker "/" de la
 * bandeja: copia el archivo a la conversacion (lib/response-assets/send-copy.ts)
 * y devuelve lo que necesita `POST /api/v1/messages`, igual que si el
 * archivo se acabara de subir desde el disco.
 *
 * Cualquier miembro puede mandar un mensaje, asi que esto usa getWorkspace()
 * y no getAdminContext(): el cliente de usuario que devuelve respeta el
 * scope de leads, asi que un Member sin acceso a esa conversacion no puede
 * dispararle una copia.
 */
export async function prepareAssetSend(
  conversationId: string,
  assetId: string,
): Promise<{ ok: true; copy: AssetChatCopy } | { ok: false; error: string }> {
  const { workspace, supabase } = await getWorkspace();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!conversation) return { ok: false, error: "No encontré esa conversación" };

  const service = await createServiceClient();
  const result = await copyAssetToChat(service, { workspaceId: workspace.id, conversationId, assetId });
  if (!result.ok) return result;

  return { ok: true, copy: result.copy };
}
