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

/**
 * La banca de audios (F20).
 *
 * Mismo patron que lib/actions/templates.ts: Owner/Admin administran,
 * cualquier miembro lee (la RLS de la 00105 ya lo resuelve), el borrado es
 * logico y a los 30 dias lo purga el cron.
 *
 * La diferencia de fondo: `description` es OBLIGATORIA y es para la IA, no
 * para la persona que lo manda -- la UI tiene que decirlo con esas palabras.
 * Y todo audio se transcribe al crearlo (el mismo job de F7, apuntando a
 * audio_assets).
 */

const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MAX_SHORTCUT = 30;
const SHORTCUT_FORMAT = /^\/[a-z0-9][a-z0-9_-]{0,29}$/;

const LIST_PATH = "/dashboard/settings/audios";

export type AudioActionResult =
  | { ok: true; audioAssetId?: string }
  | { ok: false; error: string };

export interface AudioUploadTicket {
  path: string;
  mime: string;
  token: string;
}

function normalizeShortcut(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * El error del indice unico de la 00105 dicho en castellano.
 *
 * `idx_audio_assets_shortcut` es el nombre real del indice; "duplicate key"
 * a secas cubre tambien el mensaje generico que da el mock de tests. El
 * unico indice unico que tiene esta tabla es el del atajo, asi que cualquier
 * violacion de unicidad es, en la practica, esto.
 */
function describeError(message: string | undefined): string {
  if (message?.includes("idx_audio_assets_shortcut") || message?.includes("duplicate key")) {
    return "Ya hay un audio con ese atajo";
  }
  return message ?? "error desconocido";
}

function validateFields(input: {
  name: string;
  description: string;
  shortcut?: string | null;
}): { ok: true; value: { name: string; description: string; shortcut: string | null } } | { ok: false; error: string } {
  const name = (input.name ?? "").trim();
  const description = (input.description ?? "").trim();

  if (!name) return { ok: false, error: "Poné un nombre para el audio" };
  if (name.length > MAX_NAME) return { ok: false, error: `El nombre es muy largo (máximo ${MAX_NAME} caracteres)` };

  if (!description) {
    return { ok: false, error: "La descripción es obligatoria: es lo que la IA lee para decidir cuándo usar este audio" };
  }
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, error: `La descripción es muy larga (máximo ${MAX_DESCRIPTION} caracteres)` };
  }

  const shortcut = normalizeShortcut(input.shortcut);
  if (shortcut) {
    if (shortcut.length > MAX_SHORTCUT + 1) {
      return { ok: false, error: `El atajo es muy largo (máximo ${MAX_SHORTCUT} caracteres)` };
    }
    if (!SHORTCUT_FORMAT.test(shortcut)) {
      return { ok: false, error: "El atajo solo puede tener letras, números, guiones y guiones bajos. Por ejemplo: /precio" };
    }
  }

  return { ok: true, value: { name, description, shortcut } };
}

/** Autoriza la subida de un audio a la banca. Solo Owner/Admin: mismo guardia que el resto de esta acción. */
export async function requestAudioAssetUpload(input: {
  sizeBytes: number;
  headBase64: string;
  declaredMime?: string;
}): Promise<{ ok: true; ticket: AudioUploadTicket } | { ok: false; error: string }> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden administrar la banca de audios" };

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
    console.error("[audio-library] no pude firmar la subida:", error?.message);
    return { ok: false, error: "No pude preparar la subida" };
  }

  return { ok: true, ticket: { path, mime, token: data.token } };
}

/** Encola la transcripcion, igual que afterMediaStored para un mensaje (F7). */
async function enqueueTranscription(supabase: Awaited<ReturnType<typeof createServiceClient>>, audioAssetId: string): Promise<void> {
  try {
    await scheduleJob(supabase, TRANSCRIBE_AUDIO_JOB, { audioAssetId }, new Date(), transcribeAssetDedupeKey(audioAssetId));
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "23505") {
      console.error("[audio-library] no pude encolar la transcripcion:", err instanceof Error ? err.message : err);
    }
  }
}

export interface CreateAudioAssetInput {
  name: string;
  description: string;
  shortcut?: string | null;
  storagePath: string;
  mimeType: string;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
  source: "recorded" | "uploaded";
}

export async function createAudioAsset(input: CreateAudioAssetInput): Promise<AudioActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden crear audios" };

  const { workspace, supabase, user } = ctx;

  const validated = validateFields(input);
  if (!validated.ok) return validated;

  const { data, error } = await supabase
    .from("audio_assets")
    .insert({
      workspace_id: workspace.id,
      ...validated.value,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      duration_seconds: input.durationSeconds ?? null,
      size_bytes: input.sizeBytes ?? null,
      source: input.source,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[audio-library] alta fallida:", error?.message);
    return { ok: false, error: `No pude crear el audio: ${describeError(error?.message)}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "audio_asset", entityId: data.id,
    action: "create", metadata: { name: validated.value.name }, performedBy: user.id,
  });

  const service = await createServiceClient();
  await enqueueTranscription(service, data.id);

  revalidatePath(LIST_PATH);
  return { ok: true, audioAssetId: data.id };
}

export interface UpdateAudioAssetInput {
  name: string;
  description: string;
  shortcut?: string | null;
  agentEnabled?: boolean;
  isActive?: boolean;
  /** Solo si se reemplazo el archivo: dispara una nueva transcripcion y descarta la anterior. */
  replacement?: { storagePath: string; mimeType: string; durationSeconds?: number | null; sizeBytes?: number | null };
}

export async function updateAudioAsset(audioAssetId: string, input: UpdateAudioAssetInput): Promise<AudioActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden editar audios" };

  const { workspace, supabase, user } = ctx;

  const validated = validateFields(input);
  if (!validated.ok) return validated;

  const { data: before } = await supabase
    .from("audio_assets")
    .select("id, name, description, shortcut, storage_path, agent_enabled, is_active")
    .eq("id", audioAssetId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontré ese audio" };

  const patch: Record<string, unknown> = {
    ...validated.value,
    ...(input.agentEnabled !== undefined ? { agent_enabled: input.agentEnabled } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
  };

  if (input.replacement) {
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
    .from("audio_assets")
    .update(patch)
    .eq("id", audioAssetId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[audio-library] edicion fallida:", error.message);
    return { ok: false, error: `No pude guardar el audio: ${describeError(error.message)}` };
  }

  const changes = diffFields(before, patch);
  if (changes) {
    await logAudit({
      supabase, workspaceId: workspace.id, entityType: "audio_asset", entityId: audioAssetId,
      action: "update", changes, performedBy: user.id,
    });
  }

  if (input.replacement) {
    const service = await createServiceClient();
    // El archivo viejo no se borra aca: el cron de limpieza de chat-media se
    // encarga de lo que queda huerfano, igual que con cualquier adjunto.
    await enqueueTranscription(service, audioAssetId);
  }

  revalidatePath(LIST_PATH);
  return { ok: true, audioAssetId };
}

/** Borrado logico (F20): el audio deja de aparecer y a los 30 dias se purga. */
export async function deleteAudioAsset(audioAssetId: string): Promise<AudioActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden eliminar audios" };

  const { workspace, supabase, user } = ctx;

  const { data: before } = await supabase
    .from("audio_assets")
    .select("id, name")
    .eq("id", audioAssetId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontré ese audio" };

  const { error } = await supabase
    .from("audio_assets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", audioAssetId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[audio-library] borrado fallido:", error.message);
    return { ok: false, error: `No pude eliminar el audio: ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "audio_asset", entityId: audioAssetId,
    action: "delete", metadata: { name: before.name }, performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, audioAssetId };
}

/** Corrige la transcripcion a mano (F20): un audio mal transcripto le miente al agente. */
export async function correctAudioTranscript(audioAssetId: string, text: string): Promise<AudioActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden corregir la transcripción" };

  const { workspace, supabase, user } = ctx;
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "La transcripción no puede quedar vacía" };

  const { data: before } = await supabase
    .from("audio_assets")
    .select("id, transcript")
    .eq("id", audioAssetId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "No encontré ese audio" };

  const { error } = await supabase
    .from("audio_assets")
    .update({ transcript: trimmed, transcript_status: "ready", transcript_error: null, transcript_source: "manual" })
    .eq("id", audioAssetId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[audio-library] correccion fallida:", error.message);
    return { ok: false, error: `No pude guardar la corrección: ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "audio_asset", entityId: audioAssetId,
    action: "update", changes: { transcript: { old: before.transcript, new: trimmed } }, performedBy: user.id,
  });

  revalidatePath(LIST_PATH);
  return { ok: true, audioAssetId };
}

/** La banca completa, para la pantalla de administracion. */
export async function listAudioAssets() {
  const { workspace, supabase } = await getWorkspace();

  const { data, error } = await supabase
    .from("audio_assets")
    .select("id, name, shortcut, description, storage_path, mime_type, duration_seconds, transcript, transcript_status, agent_enabled, source")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("name");

  if (error) {
    console.error("[audio-library] listado fallido:", error.message);
    return [];
  }

  return data ?? [];
}
