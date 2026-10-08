"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { sniffUploadMime } from "@/lib/content/media";
import { CHAT_MEDIA_BUCKET, extensionForMime, isSafeStoragePath } from "@/lib/chat-media/bucket";
import { scheduleJob } from "@/lib/scheduler";
import { TRANSCRIBE_AUDIO_JOB, transcribeAssetDedupeKey } from "@/lib/jobs/handlers/transcribe-audio";
import { copyAssetToChat, type AssetChatCopy } from "@/lib/response-assets/send-copy";
import { validateAssetFields, type AssetFields } from "@/lib/response-assets/shape";
import { fileRejection, isFileAssetKind, mimeMatchesKind, type FileAssetKind } from "@/lib/response-assets/files";
import { agentUsable, type TranscriptStatus } from "@/lib/response-assets/list";
import {
  ASSET_KIND_LABEL,
  hasFile,
  isAssetKind,
  isTranscribableKind,
  type AssetKind,
} from "@/lib/response-assets/kind";

/**
 * La banca de recursos: textos, audios, videos, imagenes, archivos y enlaces
 * en una sola tabla, distinguidos por `kind`.
 *
 * Permisos (banca v2, F4): los ve y los usa cualquier miembro (el widget de
 * la bandeja los necesita); crear, editar y borrar pide `templates.manage`,
 * que Owner y Admin tienen siempre y un rol personalizado puede tener. La
 * regla vive en la RLS (00131: `has_permission`) y se repite aca para poder
 * devolver un mensaje claro en vez de un silencioso "0 filas afectadas".
 *
 * Que campos exige cada tipo lo decide `lib/response-assets/shape.ts`, el
 * mismo modulo que usa el formulario: validar solo en la pantalla dejaria la
 * puerta abierta a un INSERT por la API.
 *
 * El `kind` no se cambia despues de crear: convertir un texto en audio no es
 * editar, es crear otra cosa. Por eso `updateAsset` lee el `kind` de la fila
 * existente en vez de recibirlo, y no lo toca.
 *
 * Borrado logico: el recurso desaparece de las listas y a los 30 dias lo
 * purga el cron (`purge_soft_deleted`, 00106). Su archivo se borra del bucket
 * en el momento.
 */

const MANAGE = "templates.manage";
const NO_PERMISSION = "No tenés permiso para administrar la banca de recursos. Pedíselo a un Admin.";

const LIST_PATH = "/dashboard/settings/recursos";

/** El tope de una miniatura de video (un jpg chico sacado en el navegador). */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export type AssetActionResult =
  | { ok: true; assetId?: string }
  | { ok: false; error: string };

export interface AssetUploadTicket {
  path: string;
  mime: string;
  token: string;
}

/** Un archivo ya subido con un ticket de `requestAssetUpload`. */
export interface AssetFileInput {
  storagePath: string;
  mimeType: string;
  sizeBytes?: number | null;
  durationSeconds?: number | null;
  /** 'recorded' solo para un audio grabado en el navegador. */
  source?: "recorded" | "uploaded";
  /** Solo video: la miniatura, subida con `requestAssetPreviewUpload`. */
  previewPath?: string | null;
}

export interface CreateAssetInput {
  kind: AssetKind;
  name: string;
  shortcut?: string | null;
  description?: string | null;
  tags?: string[];
  /** Texto. */
  content?: string | null;
  /** Enlace. */
  url?: string | null;
  linkKind?: string | null;
  /** Imagen, video y archivo. */
  caption?: string | null;
  /** Audio, video, imagen y archivo. */
  file?: AssetFileInput | null;
  /** Solo video: false = "este video no tiene voz" (no se transcribe ni se cobra). */
  hasVoice?: boolean;
}

export interface UpdateAssetInput {
  name: string;
  shortcut?: string | null;
  description?: string | null;
  tags?: string[];
  content?: string | null;
  url?: string | null;
  linkKind?: string | null;
  caption?: string | null;
  agentEnabled?: boolean;
  isActive?: boolean;
  /** Reemplazar el archivo: descarta la transcripcion y la miniatura anteriores. */
  replacement?: (AssetFileInput & { hasVoice?: boolean }) | null;
}

/** El error del indice unico del atajo, dicho en castellano: es unico ENTRE TODOS los tipos. */
async function describeError(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  workspaceId: string,
  shortcut: string | null,
  message: string | undefined,
): Promise<string> {
  if (message?.includes("idx_response_assets_shortcut") || message?.includes("duplicate key")) {
    if (shortcut) {
      const { data } = await supabase
        .from("response_assets")
        .select("name, kind")
        .eq("workspace_id", workspaceId)
        .eq("shortcut", shortcut)
        .is("deleted_at", null)
        .maybeSingle();
      if (data) {
        return `El atajo ${shortcut} ya lo usa "${data.name}" (${ASSET_KIND_LABEL[data.kind as AssetKind].toLowerCase()}). Elegí uno distinto.`;
      }
    }
    return "Ya hay un recurso con ese atajo. Elegí uno distinto.";
  }
  return message ?? "error desconocido";
}

/**
 * Que el archivo que llega sea uno que firmo `requestAssetUpload` para ESTE
 * workspace, y del tipo correcto. El mime lo decidio el servidor al firmar
 * (por magic bytes); aca se comprueba que no lo hayan cambiado en el camino.
 */
function checkFile(kind: FileAssetKind, workspaceId: string, file: AssetFileInput | null | undefined): string | null {
  if (!file) return "Falta el archivo";
  if (!isSafeStoragePath(file.storagePath) || !file.storagePath.startsWith(`${workspaceId}/library/`)) {
    return "Ese archivo no es de la banca de este negocio";
  }
  if (!mimeMatchesKind(kind, file.mimeType)) return "El archivo no corresponde a este tipo de recurso";
  if (!file.storagePath.endsWith(`.${extensionForMime(file.mimeType)}`)) return "El archivo no corresponde a este tipo de recurso";
  if (file.source === "recorded" && kind !== "audio") return "Solo un audio se graba en el navegador";
  if (file.previewPath) {
    if (kind !== "video") return "Solo un video tiene miniatura";
    if (!isSafeStoragePath(file.previewPath) || !file.previewPath.startsWith(`${workspaceId}/library/`)) {
      return "Esa miniatura no es de la banca de este negocio";
    }
  }
  return null;
}

/** Las columnas que cambian segun el tipo, a partir de los campos ya validados. */
function shapeColumns(fields: AssetFields) {
  return {
    name: fields.name,
    shortcut: fields.shortcut,
    description: fields.description,
    tags: fields.tags,
    content: fields.content,
    url: fields.url,
    link_kind: fields.linkKind,
    caption: fields.caption,
  };
}

/**
 * Autoriza la subida de un archivo a la banca. Decide el tipo por el
 * CONTENIDO (magic bytes), nunca por la extension declarada: `declaredMime`
 * solo desempata lo que los bytes no alcanzan a decir (Office, WebM).
 */
export async function requestAssetUpload(input: {
  kind: AssetKind;
  sizeBytes: number;
  headBase64: string;
  declaredMime?: string;
}): Promise<{ ok: true; ticket: AssetUploadTicket } | { ok: false; error: string }> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  if (!isAssetKind(input.kind) || !isFileAssetKind(input.kind)) {
    return { ok: false, error: "Ese tipo de recurso no lleva archivo" };
  }

  const mime = sniffUploadMime(new Uint8Array(Buffer.from(input.headBase64, "base64")), input.declaredMime);
  const rejection = fileRejection(input.kind, mime, input.sizeBytes);
  if (rejection || !mime) return { ok: false, error: rejection ?? "No reconozco ese archivo" };

  const path = `${ctx.workspace.id}/library/${randomUUID()}.${extensionForMime(mime)}`;
  const service = await createServiceClient();
  const { data, error } = await service.storage.from(CHAT_MEDIA_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[response-assets] no pude firmar la subida:", error?.message);
    return { ok: false, error: "No pude preparar la subida. Probá de nuevo." };
  }

  return { ok: true, ticket: { path, mime, token: data.token } };
}

/**
 * Autoriza la subida de la miniatura de un video (un jpg que saca el
 * navegador del primer fotograma). Si esto falla, el alta sigue igual: la
 * pantalla muestra el icono del tipo.
 */
export async function requestAssetPreviewUpload(input: {
  sizeBytes: number;
  headBase64: string;
}): Promise<{ ok: true; ticket: AssetUploadTicket } | { ok: false; error: string }> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_PREVIEW_BYTES) return { ok: false, error: "Miniatura inválida" };
  const mime = sniffUploadMime(new Uint8Array(Buffer.from(input.headBase64, "base64")), "image/jpeg");
  if (mime !== "image/jpeg") return { ok: false, error: "Miniatura inválida" };

  const path = `${ctx.workspace.id}/library/${randomUUID()}-preview.jpg`;
  const service = await createServiceClient();
  const { data, error } = await service.storage.from(CHAT_MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[response-assets] no pude firmar la miniatura:", error?.message);
    return { ok: false, error: "No pude preparar la miniatura" };
  }
  return { ok: true, ticket: { path, mime, token: data.token } };
}

/** Encola la transcripcion, igual que afterMediaStored para un mensaje (F7). Solo audio y video con voz. */
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

/** Borra archivos del bucket con el service client (no hay policies de escritura). Nunca lanza. */
async function removeFiles(paths: Array<string | null | undefined>): Promise<void> {
  const clean = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (clean.length === 0) return;
  const service = await createServiceClient();
  const { error } = await service.storage.from(CHAT_MEDIA_BUCKET).remove(clean);
  // Si falla, no se reintenta aca: lib/response-assets/cleanup.ts es la red
  // de seguridad a los 28 dias.
  if (error) console.error("[response-assets] no pude borrar archivos del bucket:", error.message);
}

export async function createAsset(input: CreateAssetInput): Promise<AssetActionResult> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  if (!isAssetKind(input.kind)) return { ok: false, error: "Ese tipo de recurso no existe" };
  const kind = input.kind;

  const validation = validateAssetFields(kind, { ...input, storagePath: input.file?.storagePath ?? null });
  if (!validation.ok) return { ok: false, error: validation.error };

  const insert: Record<string, unknown> = {
    workspace_id: workspace.id,
    kind,
    ...shapeColumns(validation.value),
    created_by: user.id,
  };

  let transcribe = false;
  if (isFileAssetKind(kind)) {
    const problem = checkFile(kind, workspace.id, input.file);
    if (problem) return { ok: false, error: problem };
    const file = input.file!;
    insert.storage_path = file.storagePath;
    insert.mime_type = file.mimeType;
    insert.size_bytes = file.sizeBytes ?? null;
    insert.duration_seconds = isTranscribableKind(kind) ? (file.durationSeconds ?? null) : null;
    insert.source = kind === "audio" ? (file.source ?? "uploaded") : "uploaded";
    insert.preview_path = kind === "video" ? (file.previewPath ?? null) : null;
    // Un video "sin voz" queda en 'none' y no se encola: no hay nada que
    // transcribir ni que cobrar, y el agente lo puede usar por su descripcion.
    transcribe = kind === "audio" || (kind === "video" && input.hasVoice !== false);
  }

  const { data, error } = await supabase.from("response_assets").insert(insert as never).select("id").single();

  if (error || !data) {
    console.error("[response-assets] alta fallida:", error?.message);
    return {
      ok: false,
      error: `No pude crear el recurso: ${await describeError(supabase, workspace.id, validation.value.shortcut, error?.message)}`,
    };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "response_asset", entityId: data.id,
    action: "create", metadata: { name: validation.value.name, kind }, performedBy: user.id,
  });

  if (transcribe) {
    const service = await createServiceClient();
    await enqueueTranscription(service, data.id);
  }

  revalidatePath(LIST_PATH);
  return { ok: true, assetId: data.id };
}

export async function updateAsset(assetId: string, input: UpdateAssetInput): Promise<AssetActionResult> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("response_assets")
    .select("id, kind, name, description, shortcut, tags, content, url, link_kind, caption, storage_path, preview_path, agent_enabled, is_active")
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontré ese recurso" };

  const kind = before.kind as AssetKind;
  // Se saca una copia antes de armar el patch: diffFields (y el borrado del
  // archivo viejo, mas abajo) necesitan el valor de ANTES de la edicion.
  const beforeSnapshot = { ...before };
  const replacement = input.replacement ?? null;

  const validation = validateAssetFields(kind, {
    ...input,
    storagePath: replacement?.storagePath ?? before.storage_path,
  });
  if (!validation.ok) return { ok: false, error: validation.error };

  const patch: Record<string, unknown> = {
    ...shapeColumns(validation.value),
    ...(input.agentEnabled !== undefined ? { agent_enabled: input.agentEnabled } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
  };

  let transcribe = false;
  const oldFiles: Array<string | null> = [];
  if (replacement) {
    if (!isFileAssetKind(kind)) return { ok: false, error: "Este tipo de recurso no tiene archivo" };
    const problem = checkFile(kind, workspace.id, replacement);
    if (problem) return { ok: false, error: problem };

    patch.storage_path = replacement.storagePath;
    patch.mime_type = replacement.mimeType;
    patch.size_bytes = replacement.sizeBytes ?? null;
    patch.duration_seconds = isTranscribableKind(kind) ? (replacement.durationSeconds ?? null) : null;
    if (kind === "audio") patch.source = replacement.source ?? "uploaded";
    if (kind === "video") patch.preview_path = replacement.previewPath ?? null;
    if (isTranscribableKind(kind)) {
      // Se descarta la transcripcion anterior: el archivo nuevo dice otra cosa.
      patch.transcript = null;
      patch.transcript_status = "none";
      patch.transcript_error = null;
      patch.transcript_source = "auto";
      patch.transcript_started_at = null;
      transcribe = kind === "audio" || replacement.hasVoice !== false;
    }
    // El archivo VIEJO ya no lo referencia nadie: la fila apunta al nuevo, y
    // una conversacion que lo mando se quedo con su propia COPIA
    // (lib/response-assets/send-copy.ts). Igual la miniatura vieja.
    if (before.storage_path !== replacement.storagePath) oldFiles.push(before.storage_path);
    if (kind === "video" && before.preview_path && before.preview_path !== replacement.previewPath) {
      oldFiles.push(before.preview_path);
    }
  }

  const { error } = await supabase
    .from("response_assets")
    .update(patch as never)
    .eq("id", assetId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[response-assets] edicion fallida:", error.message);
    return {
      ok: false,
      error: `No pude guardar el recurso: ${await describeError(supabase, workspace.id, validation.value.shortcut, error.message)}`,
    };
  }

  const changes = diffFields(beforeSnapshot, patch);
  if (changes) {
    await logAudit({
      supabase, workspaceId: workspace.id, entityType: "response_asset", entityId: assetId,
      action: "update", changes, performedBy: user.id,
    });
  }

  if (transcribe) {
    const service = await createServiceClient();
    await enqueueTranscription(service, assetId);
  }
  await removeFiles(oldFiles);

  revalidatePath(LIST_PATH);
  return { ok: true, assetId };
}

/**
 * Prende o apaga un recurso para el agente, sin pasar por el formulario. Un
 * audio, o un video con voz, necesita la transcripcion lista: es lo unico que
 * el agente puede "escuchar".
 */
export async function setAssetAgentEnabled(assetId: string, enabled: boolean): Promise<AssetActionResult> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("response_assets")
    .select("id, kind, transcript_status, agent_enabled")
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!before) return { ok: false, error: "No encontré ese recurso" };

  if (enabled && !agentUsable({ kind: before.kind as AssetKind, transcriptStatus: before.transcript_status as TranscriptStatus })) {
    return { ok: false, error: "El asistente solo puede usar un audio o un video con voz cuando su transcripción está lista" };
  }

  const { error } = await supabase
    .from("response_assets")
    .update({ agent_enabled: enabled })
    .eq("id", assetId)
    .eq("workspace_id", workspace.id);
  if (error) {
    console.error("[response-assets] no pude cambiar el asistente:", error.message);
    return { ok: false, error: `No pude guardar el cambio: ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "response_asset", entityId: assetId,
    action: "update", changes: { agent_enabled: { old: before.agent_enabled, new: enabled } }, performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, assetId };
}

/** Borrado logico: el recurso deja de aparecer y a los 30 dias se purga. Su archivo se borra ya. */
export async function deleteAsset(assetId: string): Promise<AssetActionResult> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("response_assets")
    .select("id, name, kind, storage_path, preview_path")
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

  // Nadie mas referencia estos archivos (una conversacion que lo mando se
  // quedo con su propia COPIA): se borran en el momento.
  if (hasFile(before.kind as AssetKind)) await removeFiles([before.storage_path, before.preview_path]);

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "response_asset", entityId: assetId,
    action: "delete", metadata: { name: before.name, kind: before.kind }, performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, assetId };
}

/**
 * Corrige la transcripcion a mano: un audio o un video mal transcripto le
 * miente al agente. Una correccion manual no la pisa ningun reintento.
 */
export async function correctTranscript(assetId: string, text: string): Promise<AssetActionResult> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
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
  if (!isTranscribableKind(before.kind as AssetKind)) return { ok: false, error: "Solo un audio o un video tiene transcripción" };
  const oldTranscript = before.transcript;

  const { error } = await supabase
    .from("response_assets")
    .update({ transcript: trimmed, transcript_status: "ready", transcript_error: null, transcript_source: "manual", transcript_started_at: null })
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

/** "Reintentar" una transcripcion que fallo: la vuelve a encolar. */
export async function retryTranscription(assetId: string): Promise<AssetActionResult> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase } = ctx;

  const { data: asset } = await supabase
    .from("response_assets")
    .select("id, kind, transcript_status, transcript_source")
    .eq("id", assetId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!asset) return { ok: false, error: "No encontré ese recurso" };
  if (!isTranscribableKind(asset.kind as AssetKind)) return { ok: false, error: "Solo un audio o un video tiene transcripción" };
  if (asset.transcript_status !== "failed") return { ok: false, error: "Esa transcripción no falló" };

  const service = await createServiceClient();
  await enqueueTranscription(service, assetId);
  revalidatePath(LIST_PATH);
  return { ok: true, assetId };
}

const LIST_COLUMNS =
  "id, kind, name, shortcut, description, tags, content, url, link_kind, caption, storage_path, preview_path, mime_type, size_bytes, duration_seconds, transcript, transcript_status, transcript_error, agent_enabled, is_active, source, usage_count, last_used_at, created_at";

/** La banca completa, para la pantalla de gestion. Cualquier miembro. */
export async function listAssets() {
  const { workspace, supabase } = await getWorkspace();

  const { data, error } = await supabase
    .from("response_assets")
    .select(LIST_COLUMNS)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("usage_count", { ascending: false })
    .order("created_at", { ascending: false })
    // Un techo, no una pagina: la pantalla pagina en memoria (mismo ranking que
    // el widget del chat y conteos exactos). A esta escala sobra.
    .limit(1000);

  if (error) {
    console.error("[response-assets] listado fallido:", error.message);
    return [];
  }

  return data ?? [];
}

/**
 * Prepara el envio de un recurso de la banca desde la bandeja: copia el
 * archivo a la conversacion (lib/response-assets/send-copy.ts) y devuelve lo
 * que necesita `POST /api/v1/messages`, igual que si el archivo se acabara de
 * subir desde el disco.
 *
 * Cualquier miembro puede mandar un mensaje, asi que esto usa getWorkspace()
 * y no el permiso de administrar: el cliente de usuario que devuelve respeta
 * el scope de leads, asi que un Member sin acceso a esa conversacion no puede
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

/**
 * Suma un uso al recurso que se acaba de mandar (para que el widget ponga
 * arriba lo que de verdad se usa). Pasa por touch_response_asset (00132):
 * cualquier miembro la puede llamar sin tener escritura sobre la tabla, y
 * solo cuenta recursos de su workspace.
 *
 * **Nunca falla hacia afuera.** El contador es un lujo, el mensaje es el
 * trabajo: se llama DESPUES de mandar, y si esto falla, se loguea y listo.
 */
export async function markAssetUsed(assetId: string): Promise<void> {
  try {
    const { supabase } = await getWorkspace();
    const { error } = await supabase.rpc("touch_response_asset", { p_asset_id: assetId });
    if (error) console.error("[response-assets] no pude contar el uso:", error.message);
  } catch (err) {
    console.error("[response-assets] no pude contar el uso:", err instanceof Error ? err.message : err);
  }
}
