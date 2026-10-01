/**
 * Lo que pasa despues de que la media quedo guardada (F7, F8).
 *
 * Los dos receptores llaman a esto al final del `after()`. Decide, por adjunto:
 *
 *   - Un audio se transcribe EN EL MOMENTO. No se encola y listo: el agente
 *     tiene 90 segundos antes de escalar, y el cron corre cada minuto, asi que
 *     esperar la cola dejaria la transcripcion siempre al filo. Si el intento
 *     falla por algo transitorio, ahi si se encola.
 *   - Una imagen se encola para describir. No corre el riesgo de que el agente
 *     escale por esperar: una imagen sin descripcion es igual de ilegible antes
 *     y despues, y describir cuesta una llamada al modelo de vision.
 *
 * Nunca lanza: corre dentro del `after()` que ya respondio 200.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { AUDIO_KINDS, type ChatAttachment } from "@/lib/messages/attachments";
import { scheduleJob } from "@/lib/scheduler";
import {
  TRANSCRIBE_AUDIO_JOB,
  transcribeDedupeKey,
  type TranscribeAudioPayload,
} from "@/lib/jobs/handlers/transcribe-audio";
import { DESCRIBE_MEDIA_JOB, describeDedupeKey } from "@/lib/jobs/handlers/describe-media";
import { transcribeMessage } from "./transcribe-message";

type Db = SupabaseClient<Database>;

/** Los kinds que se describen con el modelo de vision. Sticker queda afuera (FA7): no dice nada que haya que ver, y gastaria una llamada de vision en algo que no tiene texto. */
const IMAGE_KINDS = ["image"];

export interface AfterMediaStoredResult {
  transcribed: boolean;
  transcriptionQueued: boolean;
  descriptionQueued: boolean;
}

export async function afterMediaStored(args: {
  supabase: Db;
  messageId: string;
  items: ChatAttachment[];
  /** Si el mensaje trae texto propio: una imagen con caption igual se describe. */
  fetchImpl?: typeof fetch;
}): Promise<AfterMediaStoredResult> {
  const result: AfterMediaStoredResult = {
    transcribed: false,
    transcriptionQueued: false,
    descriptionQueued: false,
  };

  const ready = args.items.filter((item) => item.status === "ready");
  if (ready.length === 0) return result;

  const hasAudio = ready.some((item) => AUDIO_KINDS.includes(item.kind));
  const hasImage = ready.some((item) => IMAGE_KINDS.includes(item.kind));

  if (hasAudio) {
    const outcome = await transcribeMessage(args.supabase, args.messageId, { fetchImpl: args.fetchImpl });

    if (outcome.kind === "done") {
      result.transcribed = true;
    } else if (outcome.kind === "retry") {
      // Transitorio: que lo reintente la cola, con su backoff.
      result.transcriptionQueued = await enqueue(args.supabase, TRANSCRIBE_AUDIO_JOB, {
        payload: { messageId: args.messageId } satisfies TranscribeAudioPayload,
        dedupeKey: transcribeDedupeKey(args.messageId),
      });
    }
    // skipped y failed no se encolan: el primero es que otro ya la tomo, el
    // segundo ya dejo el motivo escrito y no mejora con un reintento.
  }

  if (hasImage) {
    result.descriptionQueued = await enqueue(args.supabase, DESCRIBE_MEDIA_JOB, {
      payload: { messageId: args.messageId },
      dedupeKey: describeDedupeKey(args.messageId),
    });
  }

  return result;
}

/** Encola, y trata el duplicado como lo que es: ya estaba encolado. */
async function enqueue(
  supabase: Db,
  type: string,
  args: { payload: Record<string, unknown>; dedupeKey: string },
): Promise<boolean> {
  try {
    await scheduleJob(supabase, type, args.payload, new Date(), args.dedupeKey);
    return true;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    // 23505: ya hay un job pendiente con esa clave. No es un error.
    if (code === "23505") return false;
    console.error(
      `[after-media] no pude encolar ${type}:`,
      err instanceof Error ? err.message : "error desconocido",
    );
    return false;
  }
}
