/**
 * Cuando se transcribe un audio de la banca de recursos.
 *
 * Mismo criterio que `lib/chat-media/after-stored.ts` para un mensaje que
 * entra: se intenta EN EL MOMENTO y la cola es solo el respaldo para un fallo
 * transitorio. Antes, guardar un audio solo lo dejaba en la cola y la
 * transcripcion llegaba hasta un minuto despues (el cron corre cada minuto).
 *
 *   - `transcribeAssetSoon`: lo que usan "crear" y "reemplazar el archivo".
 *     Corre en el `after()` de la Server Action, asi que GUARDAR NUNCA ESPERA
 *     a la transcripcion: la respuesta sale primero.
 *   - `transcribeAssetNow`: lo que usa el boton "Transcribir con IA". La
 *     persona apreto un boton y espera el resultado, asi que se espera.
 *
 * Los dos son seguros de repetir: `transcribeAsset` reclama la fila con un
 * UPDATE condicional (none|failed -> pending), asi que dos intentos a la vez
 * no transcriben ni cobran dos veces, y una correccion manual nunca se pisa.
 *
 * Nada de esto lanza hacia afuera.
 */

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import { TRANSCRIBE_AUDIO_JOB, transcribeAssetDedupeKey } from "@/lib/jobs/handlers/transcribe-audio";
import { transcribeAsset, type TranscribeAssetResult } from "./transcribe";

type Db = SupabaseClient<Database>;

/** Encola la transcripcion (el respaldo). Un duplicado no es un error: ya estaba encolada. */
export async function enqueueAssetTranscription(supabase: Db, assetId: string): Promise<void> {
  try {
    await scheduleJob(supabase, TRANSCRIBE_AUDIO_JOB, { assetId }, new Date(), transcribeAssetDedupeKey(assetId));
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "23505") {
      console.error("[response-assets] no pude encolar la transcripcion:", err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Intenta ya. Si falla por algo transitorio (`retry`), la cola lo reintenta
 * con su backoff; un fallo permanente (`failed`) ya dejo su motivo escrito en
 * la fila y no mejora con un reintento.
 */
export async function transcribeAssetNow(supabase: Db, assetId: string): Promise<TranscribeAssetResult> {
  const outcome = await transcribeAsset(supabase, assetId);
  if (outcome.kind === "retry") await enqueueAssetTranscription(supabase, assetId);
  return outcome;
}

/**
 * Despues de responder, sin hacer esperar a quien guarda.
 *
 * Si no hay un request en curso donde colgar el `after()` (un script, un
 * test), se cae al camino de antes: encolar.
 */
export async function transcribeAssetSoon(supabase: Db, assetId: string): Promise<void> {
  try {
    after(async () => {
      try {
        await transcribeAssetNow(supabase, assetId);
      } catch (err) {
        console.error("[response-assets] fallo la transcripcion inmediata:", err instanceof Error ? err.message : err);
        await enqueueAssetTranscription(supabase, assetId);
      }
    });
  } catch {
    await enqueueAssetTranscription(supabase, assetId);
  }
}
