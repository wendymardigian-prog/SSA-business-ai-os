/**
 * Transcribir un audio, o un video con voz, de la banca de recursos.
 *
 * Mismo patron que `lib/chat-media/transcribe-message.ts` (F7): claim
 * condicional, el mismo proveedor (`lib/ai/transcribe.ts`, que no sabe quien
 * transcribe), y nunca lanza -- el job decide si reintenta.
 *
 * Dos diferencias con F7:
 *   - El claim tambien excluye `transcript_source = 'manual'`. Si alguien
 *     corrigio la transcripcion a mano, ningun reintento automatico la puede
 *     pisar -- ni siquiera uno transitorio que la hubiera dejado en `failed`
 *     antes de la correccion.
 *   - El claim filtra `kind IN ('audio', 'video')`: un texto, una imagen,
 *     un archivo o un enlace nunca tienen nada que transcribir (su
 *     `transcript_status` queda forzado en 'none' por el CHECK
 *     `response_assets_no_transcript`, 00131), asi que ni se intenta.
 *
 * Un video (banca v2, F12) pasa por la MISMA puerta (`lib/ai/transcribe.ts`):
 * el proveedor acepta el mp4 o el webm entero, sin extraer el audio. Un
 * formato que no acepta (un .mov) queda en `failed` con su motivo ANTES de
 * llamar al proveedor: no se gasta una llamada ni se cobra.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { assetTranscriptionSupport, transcribeAudio } from "@/lib/ai/transcribe";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";

type Db = SupabaseClient<Database>;

export type TranscribeAssetResult =
  | { kind: "done"; text: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "retry"; reason: string };

export interface TranscribeAssetOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export async function transcribeAsset(
  supabase: Db,
  assetId: string,
  options: TranscribeAssetOptions = {},
): Promise<TranscribeAssetResult> {
  const now = options.now ?? (() => new Date());

  try {
    const { data: claimed, error: claimError } = await supabase
      .from("response_assets")
      .update({ transcript_status: "pending", transcript_started_at: now().toISOString(), transcript_error: null })
      .eq("id", assetId)
      .in("kind", ["audio", "video"])
      .in("transcript_status", ["none", "failed"])
      .neq("transcript_source", "manual")
      .select("id, workspace_id, storage_path, mime_type")
      .maybeSingle();

    if (claimError) {
      console.error("[response-assets] no pude reclamar el recurso:", claimError.message);
      return { kind: "retry", reason: "no pude reclamar el recurso" };
    }
    if (!claimed) return { kind: "skipped", reason: "ya lo tomo otro, es una correccion manual, o no es un audio ni un video" };
    if (!claimed.storage_path || !claimed.mime_type) {
      // No deberia pasar nunca (el CHECK de forma lo exige), pero sin archivo
      // no hay nada que transcribir.
      await fail(supabase, assetId, "El recurso no tiene archivo para transcribir");
      return { kind: "failed", reason: "sin archivo" };
    }

    // Antes de bajar nada ni llamar al proveedor: un formato que no acepta
    // queda en `failed` con un motivo legible, sin cobrar.
    const support = assetTranscriptionSupport(claimed.mime_type);
    if (!support.ok) {
      await fail(supabase, assetId, support.reason);
      return { kind: "failed", reason: "formato no soportado" };
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .download(claimed.storage_path);

    if (downloadError || !file) {
      await revert(supabase, assetId, "No pudimos abrir el archivo");
      return { kind: "retry", reason: "no pude bajar el archivo" };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await transcribeAudio({
      supabase,
      workspaceId: claimed.workspace_id,
      bytes,
      mime: claimed.mime_type,
      threadId: assetId,
      conversationId: null,
      fetchImpl: options.fetchImpl,
    });

    if (!result.ok) {
      if (result.retryable) {
        await revert(supabase, assetId, result.message);
        return { kind: "retry", reason: result.code };
      }
      await fail(supabase, assetId, result.message);
      return { kind: "failed", reason: result.code };
    }

    const { error: saveError } = await supabase
      .from("response_assets")
      .update({
        transcript: result.text,
        transcript_status: "ready",
        transcript_error: null,
        transcript_source: "auto",
      })
      .eq("id", assetId);

    if (saveError) {
      console.error("[response-assets] no pude guardar la transcripcion:", saveError.message);
      return { kind: "retry", reason: "no pude guardar la transcripcion" };
    }

    return { kind: "done", text: result.text };
  } catch (err) {
    console.error(
      "[response-assets] error inesperado transcribiendo:",
      err instanceof Error ? err.message : "error desconocido",
    );
    return { kind: "retry", reason: "error inesperado" };
  }
}

async function fail(supabase: Db, assetId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from("response_assets")
    .update({ transcript_status: "failed", transcript_error: message })
    .eq("id", assetId);
  if (error) console.error("[response-assets] no pude marcar el fallo:", error.message);
}

async function revert(supabase: Db, assetId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from("response_assets")
    .update({ transcript_status: "failed", transcript_error: message })
    .eq("id", assetId);
  if (error) console.error("[response-assets] no pude liberar el audio:", error.message);
}

/** Mismo criterio que `reapStuckTranscriptions` (F7), para la banca de recursos. */
const STUCK_TRANSCRIPT_MS = 10 * 60 * 1000;

export async function reapStuckAssetTranscriptions(supabase: Db, now: Date = new Date()): Promise<{ freed: number }> {
  const cutoff = new Date(now.getTime() - STUCK_TRANSCRIPT_MS).toISOString();

  try {
    const { data, error } = await supabase
      .from("response_assets")
      .update({ transcript_status: "failed", transcript_error: "La transcripción no terminó. Probá con Reintentar." })
      .eq("transcript_status", "pending")
      .lt("transcript_started_at", cutoff)
      .select("id");

    if (error) {
      console.error("[response-assets] no pude liberar las transcripciones colgadas:", error.message);
      return { freed: 0 };
    }
    return { freed: data?.length ?? 0 };
  } catch (err) {
    console.error("[response-assets] error inesperado en el reaper:", err instanceof Error ? err.message : "desconocido");
    return { freed: 0 };
  }
}
