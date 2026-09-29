/**
 * Transcribir el audio de un mensaje (F7).
 *
 * La misma funcion la usan dos caminos, y esa es la idea:
 *
 *   - El `after()` del webhook, apenas termina de bajar el archivo. Asi la
 *     transcripcion esta en segundos y el agente la encuentra cuando corre su
 *     turno, en vez de esperar al cron del minuto.
 *   - El job `transcribe_audio`, como respaldo y para el reintento manual.
 *
 * Que los dos caminos no se pisen lo garantiza el CLAIM CONDICIONAL: la fila
 * pasa de `none|failed` a `pending` en una sola sentencia, y el que no consigue
 * la fila se va sin llamar al proveedor. Sin eso, un audio se transcribiria dos
 * veces y se cobraria dos veces.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { AUDIO_KINDS, parseAttachments } from "@/lib/messages/attachments";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { previewForMessage } from "@/lib/message-preview";
import { CHAT_MEDIA_BUCKET } from "./bucket";

type Db = SupabaseClient<Database>;

/** Cuanto puede quedar un `pending` antes de que el reaper lo libere. */
export const STUCK_TRANSCRIPT_MS = 10 * 60 * 1000;

export type TranscribeMessageResult =
  | { kind: "done"; text: string }
  /** Otro camino ya la tomo, o el mensaje no tiene audio que transcribir. */
  | { kind: "skipped"; reason: string }
  /** Fallo permanente: ya quedo escrito en la fila. No se reintenta. */
  | { kind: "failed"; reason: string }
  /** Fallo transitorio: quien llama decide si relanza para que la cola lo tome. */
  | { kind: "retry"; reason: string };

export interface TranscribeMessageOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/**
 * Transcribe el audio de un mensaje. Nunca lanza.
 *
 * Devuelve `retry` cuando vale la pena volver a intentar; el handler del job es
 * el que traduce eso en un throw, porque es el unico que tiene una cola atras.
 */
export async function transcribeMessage(
  supabase: Db,
  messageId: string,
  options: TranscribeMessageOptions = {},
): Promise<TranscribeMessageResult> {
  const now = options.now ?? (() => new Date());

  try {
    // 1. El claim. Condicional en la base: si otro camino ya la tomo, esta
    //    sentencia no devuelve fila y aca se termina.
    const { data: claimed, error: claimError } = await supabase
      .from("messages")
      .update({ transcript_status: "pending", transcript_started_at: now().toISOString(), transcript_error: null })
      .eq("id", messageId)
      .in("transcript_status", ["none", "failed"])
      .select("id, workspace_id, conversation_id, attachments, text")
      .maybeSingle();

    if (claimError) {
      console.error("[transcribe] no pude reclamar el mensaje:", claimError.message);
      return { kind: "retry", reason: "no pude reclamar el mensaje" };
    }
    if (!claimed) return { kind: "skipped", reason: "ya la tomo otro" };

    // 2. El audio. Se busca el primer adjunto de audio que este listo.
    const items = parseAttachments(claimed.attachments);
    const audio = items.find((item) => AUDIO_KINDS.includes(item.kind) && item.status === "ready" && item.storagePath);

    if (!audio?.storagePath) {
      return await fail(supabase, messageId, "El audio todavía no está disponible para transcribir");
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .download(audio.storagePath);

    if (downloadError || !file) {
      // Puede ser transitorio (Storage caido) o permanente (se purgo por
      // retencion). Se trata como transitorio: si el archivo no vuelve, el
      // reintento falla igual y no se pierde nada.
      await revert(supabase, messageId, "No pudimos abrir el archivo de audio");
      return { kind: "retry", reason: "no pude bajar el archivo" };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // 3. El proveedor.
    const result = await transcribeAudio({
      supabase,
      workspaceId: claimed.workspace_id,
      bytes,
      mime: audio.mime,
      threadId: messageId,
      conversationId: claimed.conversation_id,
      fetchImpl: options.fetchImpl,
    });

    if (!result.ok) {
      if (result.retryable) {
        // Vuelve a `failed` para que el claim la pueda retomar. Si quedara en
        // `pending`, el reintento se saltearia solo hasta que lo libere el reaper.
        await revert(supabase, messageId, result.message);
        return { kind: "retry", reason: result.code };
      }
      await fail(supabase, messageId, result.message);
      return { kind: "failed", reason: result.code };
    }

    // 4. Guardar. `interpretability` pasa a 'transcribed' salvo que el mensaje
    //    ya tuviera texto propio (un caption): ahi el texto sigue mandando.
    const { error: saveError } = await supabase
      .from("messages")
      .update({
        transcript: result.text,
        transcript_status: "ready",
        transcript_seconds: result.durationSeconds,
        transcript_error: null,
        interpretability: claimed.text ? "text" : "transcribed",
      })
      .eq("id", messageId);

    if (saveError) {
      console.error("[transcribe] no pude guardar la transcripcion:", saveError.message);
      return { kind: "retry", reason: "no pude guardar la transcripcion" };
    }

    // 5. El preview de la lista: la transcripcion dice mas que "Nota de voz".
    //    Solo si este es el ultimo mensaje de la conversacion; si no, se estaria
    //    reescribiendo el preview con algo viejo.
    await refreshPreview(supabase, claimed.conversation_id, messageId, {
      text: claimed.text,
      transcript: result.text,
      attachments: claimed.attachments,
    });

    return { kind: "done", text: result.text };
  } catch (err) {
    console.error(
      "[transcribe] error inesperado transcribiendo:",
      err instanceof Error ? err.message : "error desconocido",
    );
    return { kind: "retry", reason: "error inesperado" };
  }
}

/** Fallo permanente: queda escrito y no se reintenta solo. */
async function fail(supabase: Db, messageId: string, message: string): Promise<TranscribeMessageResult> {
  const { error } = await supabase
    .from("messages")
    .update({ transcript_status: "failed", transcript_error: message, interpretability: "unreadable" })
    .eq("id", messageId);
  if (error) console.error("[transcribe] no pude marcar el fallo:", error.message);
  return { kind: "failed", reason: message };
}

/** Fallo transitorio: vuelve a `failed` para que el claim la pueda retomar. */
async function revert(supabase: Db, messageId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .update({ transcript_status: "failed", transcript_error: message })
    .eq("id", messageId);
  if (error) console.error("[transcribe] no pude liberar el mensaje:", error.message);
}

/** El preview de la conversacion, si este mensaje sigue siendo el ultimo. */
async function refreshPreview(
  supabase: Db,
  conversationId: string,
  messageId: string,
  message: { text: string | null; transcript: string; attachments: unknown },
): Promise<void> {
  const { data: last } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last?.id !== messageId) return;

  const { error } = await supabase
    .from("conversations")
    .update({ last_message_preview: previewForMessage(message) })
    .eq("id", conversationId);

  if (error) console.error("[transcribe] no pude actualizar el preview:", error.message);
}

/**
 * Libera las transcripciones colgadas (F7).
 *
 * Un `pending` de mas de diez minutos es una que nadie va a terminar: el
 * `after()` del webhook se corto, o el proceso se murio a mitad. Sin esto la
 * bandeja queda con "Transcribiendo…" girando para siempre y el mensaje no se
 * reintenta nunca, porque el claim ve `pending` y se saltea.
 *
 * Nunca lanza: es una tarea de higiene, no puede voltear el cron.
 */
export async function reapStuckTranscriptions(
  supabase: Db,
  now: Date = new Date(),
): Promise<{ freed: number }> {
  const cutoff = new Date(now.getTime() - STUCK_TRANSCRIPT_MS).toISOString();

  try {
    const { data, error } = await supabase
      .from("messages")
      .update({
        transcript_status: "failed",
        transcript_error: "La transcripción no terminó. Probá con Reintentar.",
      })
      .eq("transcript_status", "pending")
      .lt("transcript_started_at", cutoff)
      .select("id");

    if (error) {
      console.error("[transcribe] no pude liberar las transcripciones colgadas:", error.message);
      return { freed: 0 };
    }

    const freed = data?.length ?? 0;
    if (freed > 0) console.log(`[transcribe] libere ${freed} transcripcion(es) colgada(s)`);
    return { freed };
  } catch (err) {
    console.error("[transcribe] error inesperado en el reaper:", err instanceof Error ? err.message : "desconocido");
    return { freed: 0 };
  }
}
