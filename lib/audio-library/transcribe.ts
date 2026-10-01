/**
 * Transcribir un audio de la banca (F20).
 *
 * Mismo patron que `lib/chat-media/transcribe-message.ts` (F7): claim
 * condicional, el mismo proveedor (`lib/ai/transcribe.ts`, que no sabe quien
 * transcribe), y nunca lanza -- el job decide si reintenta.
 *
 * La diferencia: el claim tambien excluye `transcript_source = 'manual'`. Si
 * alguien corrigio la transcripcion a mano, ningun reintento automatico la
 * puede pisar -- ni siquiera uno transitorio que la hubiera dejado en
 * `failed` antes de la correccion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";

type Db = SupabaseClient<Database>;

export type TranscribeAudioAssetResult =
  | { kind: "done"; text: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "retry"; reason: string };

export interface TranscribeAudioAssetOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export async function transcribeAudioAsset(
  supabase: Db,
  audioAssetId: string,
  options: TranscribeAudioAssetOptions = {},
): Promise<TranscribeAudioAssetResult> {
  const now = options.now ?? (() => new Date());

  try {
    const { data: claimed, error: claimError } = await supabase
      .from("audio_assets")
      .update({ transcript_status: "pending", transcript_started_at: now().toISOString(), transcript_error: null })
      .eq("id", audioAssetId)
      .in("transcript_status", ["none", "failed"])
      .neq("transcript_source", "manual")
      .select("id, workspace_id, storage_path, mime_type")
      .maybeSingle();

    if (claimError) {
      console.error("[audio-library] no pude reclamar el audio:", claimError.message);
      return { kind: "retry", reason: "no pude reclamar el audio" };
    }
    if (!claimed) return { kind: "skipped", reason: "ya lo tomo otro, o es una correccion manual" };

    const { data: file, error: downloadError } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .download(claimed.storage_path);

    if (downloadError || !file) {
      await revert(supabase, audioAssetId, "No pudimos abrir el archivo de audio");
      return { kind: "retry", reason: "no pude bajar el archivo" };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await transcribeAudio({
      supabase,
      workspaceId: claimed.workspace_id,
      bytes,
      mime: claimed.mime_type,
      threadId: audioAssetId,
      conversationId: null,
      fetchImpl: options.fetchImpl,
    });

    if (!result.ok) {
      if (result.retryable) {
        await revert(supabase, audioAssetId, result.message);
        return { kind: "retry", reason: result.code };
      }
      await fail(supabase, audioAssetId, result.message);
      return { kind: "failed", reason: result.code };
    }

    const { error: saveError } = await supabase
      .from("audio_assets")
      .update({
        transcript: result.text,
        transcript_status: "ready",
        transcript_error: null,
        transcript_source: "auto",
      })
      .eq("id", audioAssetId);

    if (saveError) {
      console.error("[audio-library] no pude guardar la transcripcion:", saveError.message);
      return { kind: "retry", reason: "no pude guardar la transcripcion" };
    }

    return { kind: "done", text: result.text };
  } catch (err) {
    console.error(
      "[audio-library] error inesperado transcribiendo:",
      err instanceof Error ? err.message : "error desconocido",
    );
    return { kind: "retry", reason: "error inesperado" };
  }
}

async function fail(supabase: Db, audioAssetId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from("audio_assets")
    .update({ transcript_status: "failed", transcript_error: message })
    .eq("id", audioAssetId);
  if (error) console.error("[audio-library] no pude marcar el fallo:", error.message);
}

async function revert(supabase: Db, audioAssetId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from("audio_assets")
    .update({ transcript_status: "failed", transcript_error: message })
    .eq("id", audioAssetId);
  if (error) console.error("[audio-library] no pude liberar el audio:", error.message);
}

/** Mismo criterio que `reapStuckTranscriptions` (F7), para la banca de audios. */
const STUCK_TRANSCRIPT_MS = 10 * 60 * 1000;

export async function reapStuckAudioAssetTranscriptions(supabase: Db, now: Date = new Date()): Promise<{ freed: number }> {
  const cutoff = new Date(now.getTime() - STUCK_TRANSCRIPT_MS).toISOString();

  try {
    const { data, error } = await supabase
      .from("audio_assets")
      .update({ transcript_status: "failed", transcript_error: "La transcripción no terminó. Probá con Reintentar." })
      .eq("transcript_status", "pending")
      .lt("transcript_started_at", cutoff)
      .select("id");

    if (error) {
      console.error("[audio-library] no pude liberar las transcripciones colgadas:", error.message);
      return { freed: 0 };
    }
    return { freed: data?.length ?? 0 };
  } catch (err) {
    console.error("[audio-library] error inesperado en el reaper:", err instanceof Error ? err.message : "desconocido");
    return { freed: 0 };
  }
}
