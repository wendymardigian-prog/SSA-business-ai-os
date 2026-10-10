import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { generateText } from "ai";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { openAiRun } from "@/lib/ai/run";
import { parseAttachments } from "@/lib/messages/attachments";
import { CHAT_MEDIA_BUCKET } from "@/lib/chat-media/bucket";
import { MEDIA_DESCRIPTION_DEFAULT_INSTRUCTIONS } from "@/lib/ai-tasks/instructions";
import { loadTaskInstructions } from "@/lib/ai-tasks/store";

type Db = SupabaseClient<Database>;

/**
 * Describir una imagen para que el agente sepa que le mandaron (F8).
 *
 * Sin esto, una captura de pantalla sin texto es un mensaje vacio: el agente no
 * la ve y la compuerta de interpretabilidad escala la conversacion. Con una
 * descripcion de dos lineas, el agente puede contestar.
 *
 * No suma ningun proveedor: usa el modelo de vision que el workspace ya tiene
 * conectado (OpenAI, Google o Anthropic; los tres ven imagenes). Si no hay
 * ninguno, el mensaje queda como no interpretable y el agente escala, que es el
 * comportamiento deseado.
 *
 * El prompt pide dos cosas y en ese orden: que se ve, y **el texto que aparezca
 * en la imagen**. La mayoria de lo que mandan los leads son capturas de
 * pantalla, y ahi el texto es el mensaje.
 */
export const DESCRIBE_MEDIA_JOB = "describe_media";

export interface DescribeMediaPayload {
  messageId: string;
}

export function describeDedupeKey(messageId: string): string {
  return `describe:${messageId}`;
}

/** Los kinds que se describen. Sticker queda afuera (FA7): ver after-stored.ts. */
const IMAGE_KINDS = ["image"];

/** El techo de la descripcion. Es contexto para el agente, no un informe. */
export const MEDIA_DESCRIPTION_MAX_CHARS = 300;
const MAX_CHARS = MEDIA_DESCRIPTION_MAX_CHARS;

/**
 * Los proveedores con vision, en orden de preferencia.
 *
 * OpenAI y Google primero porque son los mas baratos para una imagen chica.
 * Anthropic sirve igual y queda como tercero.
 */
const VISION_PROVIDERS = ["openai", "google_ai", "anthropic"];

/** El texto de siempre, igual a `MEDIA_DESCRIPTION_DEFAULT_INSTRUCTIONS` (Agentes IA). */
const PROMPT = MEDIA_DESCRIPTION_DEFAULT_INSTRUCTIONS;

/**
 * La descripcion de la imagen de un mensaje. Nunca lanza para lo permanente.
 *
 * Mismo criterio y misma forma que `transcribeMessage` (lib/chat-media/
 * transcribe-message.ts): toma `supabase` directo, no un `JobContext`, para
 * que la use tanto el `after()` del webhook (FA6: la imagen se describe EN EL
 * MOMENTO, no se espera a la cola) como el job `describe_media`, que queda de
 * respaldo para el reintento transitorio y el manual.
 *
 * Mismo criterio de fallos que la transcripcion: un fallo transitorio
 * devuelve "retry" para que quien llama decida (el job relanza; el `after()`
 * encola); uno permanente deja el mensaje marcado y retorna normal.
 */
export async function describeMessageMedia(
  supabase: Db,
  messageId: string,
): Promise<{ kind: "done" | "skipped" | "failed" | "retry"; reason?: string }> {
  // El claim: `media_description` pasa de null a '' (en curso). Si otro camino
  // ya la tomo, esta sentencia no devuelve fila.
  const { data: claimed, error: claimError } = await supabase
    .from("messages")
    .update({ media_description: "" })
    .eq("id", messageId)
    .is("media_description", null)
    .select("id, workspace_id, attachments, text")
    .maybeSingle();

  if (claimError) {
    console.error("[describe_media] no pude reclamar el mensaje:", claimError.message);
    return { kind: "retry", reason: "claim" };
  }
  if (!claimed) return { kind: "skipped", reason: "ya la tomo otro" };

  const items = parseAttachments(claimed.attachments);
  const image = items.find((item) => IMAGE_KINDS.includes(item.kind) && item.status === "ready" && item.storagePath);

  if (!image?.storagePath) {
    // FA7: un sticker o un GIF solos no son ilegibles -- effectiveMessageText
    // ya los etiqueta sin necesitar una descripcion. Si este job se llegara a
    // invocar para uno (hoy afterMediaStored ya no lo encola), marcarlo
    // "unreadable" seria falso: label_only es el estado que corresponde.
    const onlyLabelable = items.length > 0 && items.every((item) => item.kind === "sticker" || item.kind === "gif");
    if (onlyLabelable) {
      const { error } = await supabase
        .from("messages")
        .update({ media_description: null, interpretability: "label_only" })
        .eq("id", messageId);
      if (error) console.error("[describe_media] no pude marcar el mensaje:", error.message);
      return { kind: "skipped", reason: "sticker o gif: no hace falta describir" };
    }
    return await giveUp(supabase, messageId, "La imagen no está disponible");
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .download(image.storagePath);

  if (downloadError || !file) {
    await release(supabase, messageId);
    return { kind: "retry", reason: "no pude bajar la imagen" };
  }

  // El modelo de vision del workspace. Se prueban los tres en orden; si no hay
  // ninguno conectado, el mensaje queda no interpretable y el agente escala.
  let resolved = null as Awaited<ReturnType<typeof getWorkspaceModel>> | null;
  for (const provider of VISION_PROVIDERS) {
    const attempt = await getWorkspaceModel(claimed.workspace_id, { preferredProvider: provider, supabase });
    if (attempt.ok && attempt.provider === provider) {
      resolved = attempt;
      break;
    }
  }

  if (!resolved?.ok || !resolved.model) {
    return await giveUp(
      supabase,
      messageId,
      "No hay ningún modelo con visión conectado para describir la imagen",
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const run = await openAiRun(supabase, {
    workspaceId: claimed.workspace_id,
    source: "media_description",
    trigger: "job",
    threadId: messageId,
    provider: resolved.provider ?? null,
    model: resolved.modelId ?? null,
  });

  // Las instrucciones editables de la tarea (Agentes IA): sin version activa,
  // o si algo falla al leerla, se usa PROMPT (el texto del sistema).
  const instructions = await loadTaskInstructions(supabase, claimed.workspace_id, "media_description");

  let text: string;
  try {
    const result = await generateText({
      model: resolved.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instructions.text || PROMPT },
            { type: "image", image: bytes, mediaType: image.mime ?? "image/jpeg" },
          ],
        },
      ],
      maxOutputTokens: 300,
    });
    text = result.text.trim().slice(0, MAX_CHARS);
    run.setFinalUsage(result.totalUsage);
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    await run.close({ status: "error", statusDetail: "vision_failed", error: message });
    await release(supabase, messageId);
    // Una caida del proveedor vale reintentar; el claim ya quedo liberado.
    return { kind: "retry", reason: "el modelo de vision fallo" };
  }

  await run.close({ status: "responded" });

  if (text.length === 0) {
    return await giveUp(supabase, messageId, "El modelo no devolvió ninguna descripción");
  }

  const { error: saveError } = await supabase
    .from("messages")
    .update({
      media_description: text,
      // Si el mensaje ya tenia texto propio (un caption), el texto sigue
      // mandando: la descripcion es contexto de mas, no el contenido.
      interpretability: claimed.text ? "text" : "described",
    })
    .eq("id", messageId);

  if (saveError) {
    console.error("[describe_media] no pude guardar la descripcion:", saveError.message);
    return { kind: "retry", reason: "no pude guardar" };
  }

  return { kind: "done" };
}

/** Permanente: el mensaje queda no interpretable y el agente va a escalar. */
async function giveUp(
  supabase: Db,
  messageId: string,
  reason: string,
): Promise<{ kind: "failed"; reason: string }> {
  const { error } = await supabase
    .from("messages")
    .update({ media_description: null, interpretability: "unreadable" })
    .eq("id", messageId);
  if (error) console.error("[describe_media] no pude marcar el mensaje:", error.message);
  console.warn(`[describe_media] ${messageId}: ${reason}`);
  return { kind: "failed", reason };
}

/** Transitorio: se libera el claim para que el reintento lo pueda tomar. */
async function release(supabase: Db, messageId: string): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .update({ media_description: null })
    .eq("id", messageId);
  if (error) console.error("[describe_media] no pude liberar el mensaje:", error.message);
}

async function handleDescribeMedia(context: JobContext): Promise<void> {
  const payload = context.job.payload as unknown as DescribeMediaPayload;
  const messageId = payload?.messageId;

  if (!messageId) {
    console.error("[describe_media] el job llego sin messageId");
    return;
  }

  const result = await describeMessageMedia(context.supabase, messageId);
  if (result.kind === "retry") {
    throw new Error(`no pude describir la imagen (${result.reason})`);
  }
}

export function registerDescribeMediaHandler(): void {
  registerJobHandler(DESCRIBE_MEDIA_JOB, handleDescribeMedia);
}
