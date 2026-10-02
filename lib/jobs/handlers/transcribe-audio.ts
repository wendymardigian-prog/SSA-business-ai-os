import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { reapStuckTranscriptions, transcribeMessage } from "@/lib/chat-media/transcribe-message";
import { reapStuckAssetTranscriptions, transcribeAsset } from "@/lib/response-assets/transcribe";

/**
 * El job de transcripcion (F7, y para la banca de recursos).
 *
 * Transcribir no bloquea el webhook: el receptor lo intenta en el momento (que
 * es lo que hace que el agente la encuentre a tiempo) y, si falla por algo
 * transitorio, encola este job para que la cola lo reintente con su backoff.
 *
 * Tambien es el camino del reintento manual desde la bandeja, y el que usa
 * la banca de recursos al crear o reemplazar el archivo de un audio: mismo
 * job, mismo claim condicional, apuntando a `response_assets` en vez de
 * `messages` segun que trae el payload.
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
  /** La banca de recursos: mutuamente excluyente con messageId. */
  assetId?: string;
}

/** La clave de dedupe: un job pendiente por mensaje, no diez. */
export function transcribeDedupeKey(messageId: string): string {
  return `transcribe:${messageId}`;
}

/** La clave de dedupe para un audio de la banca de recursos. */
export function transcribeAssetDedupeKey(assetId: string): string {
  return `transcribe-asset:${assetId}`;
}

async function handleTranscribeAudio(context: JobContext): Promise<void> {
  // De paso, higiene: libera los `pending` colgados antes de trabajar. Es un
  // UPDATE sobre un indice parcial que normalmente esta vacio.
  await reapStuckTranscriptions(context.supabase);
  await reapStuckAssetTranscriptions(context.supabase);

  const payload = context.job.payload as unknown as TranscribeAudioPayload;

  if (payload?.assetId) {
    const result = await transcribeAsset(context.supabase, payload.assetId);
    if (result.kind === "retry") {
      throw new Error(`no pude transcribir el audio de la banca (${result.reason})`);
    }
    return;
  }

  const messageId = payload?.messageId;
  if (!messageId) {
    // Sin id no hay nada que hacer y reintentar no lo va a inventar.
    console.error("[transcribe_audio] el job llego sin messageId ni assetId");
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
