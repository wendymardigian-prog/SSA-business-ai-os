import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { reapStuckTranscriptions, transcribeMessage } from "@/lib/chat-media/transcribe-message";
import { reapStuckAudioAssetTranscriptions, transcribeAudioAsset } from "@/lib/audio-library/transcribe";

/**
 * El job de transcripcion (F7, y F20 para la banca de audios).
 *
 * Transcribir no bloquea el webhook: el receptor lo intenta en el momento (que
 * es lo que hace que el agente la encuentre a tiempo) y, si falla por algo
 * transitorio, encola este job para que la cola lo reintente con su backoff.
 *
 * Tambien es el camino del reintento manual desde la bandeja, y el que usa
 * la banca de audios al crear o reemplazar un archivo (F20): mismo job,
 * mismo claim condicional, apuntando a `audio_assets` en vez de `messages`
 * segun que trae el payload.
 *
 * La regla del handler, que es la misma que usa `index_document`:
 *
 *   - Fallo transitorio  -> LANZA. La cola reintenta con backoff (10 s, 20 s).
 *   - Fallo permanente   -> retorna normal. El motivo ya quedo en la fila, y
 *                           gastar los tres intentos no lo va a arreglar.
 */
export const TRANSCRIBE_AUDIO_JOB = "transcribe_audio";

export interface TranscribeAudioPayload {
  messageId?: string;
  /** La banca de audios (F20): mutuamente excluyente con messageId. */
  audioAssetId?: string;
}

/** La clave de dedupe: un job pendiente por mensaje, no diez. */
export function transcribeDedupeKey(messageId: string): string {
  return `transcribe:${messageId}`;
}

/** La clave de dedupe para un audio de la banca (F20). */
export function transcribeAssetDedupeKey(audioAssetId: string): string {
  return `transcribe-asset:${audioAssetId}`;
}

async function handleTranscribeAudio(context: JobContext): Promise<void> {
  // De paso, higiene: libera los `pending` colgados antes de trabajar. Es un
  // UPDATE sobre un indice parcial que normalmente esta vacio.
  await reapStuckTranscriptions(context.supabase);
  await reapStuckAudioAssetTranscriptions(context.supabase);

  const payload = context.job.payload as unknown as TranscribeAudioPayload;

  if (payload?.audioAssetId) {
    const result = await transcribeAudioAsset(context.supabase, payload.audioAssetId);
    if (result.kind === "retry") {
      throw new Error(`no pude transcribir el audio de la banca (${result.reason})`);
    }
    return;
  }

  const messageId = payload?.messageId;
  if (!messageId) {
    // Sin id no hay nada que hacer y reintentar no lo va a inventar.
    console.error("[transcribe_audio] el job llego sin messageId ni audioAssetId");
    return;
  }

  const result = await transcribeMessage(context.supabase, messageId);

  if (result.kind === "retry") {
    // Lanza para que la cola lo tome de nuevo. El motivo va a `last_error`.
    throw new Error(`no pude transcribir (${result.reason})`);
  }

  // done, skipped y failed terminan el job: los tres ya dejaron la fila como
  // corresponde, y ninguno mejora con un reintento.
}

export function registerTranscribeAudioHandler(): void {
  registerJobHandler(TRANSCRIBE_AUDIO_JOB, handleTranscribeAudio);
}
