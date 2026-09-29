/**
 * Traer adentro la media que llega por el chat (F3, F4).
 *
 * Por que existe: los archivos que mandan los leads no son nuestros y no duran.
 * La `url` que da Instagram es del CDN de Meta y VENCE; la de WhatsApp es un
 * `.enc` cifrado que no se puede abrir sin la `mediaKey`. Si no copiamos el
 * archivo cuando llega, despues no hay nada que reproducir ni que transcribir,
 * y el agente responde a ciegas. Por eso la descarga va dentro del `after()`
 * del webhook y no en la cola: el 200 ya salio, pero no se espera al cron.
 *
 * Reglas que valen para los dos canales:
 *
 * - **Nunca lanza.** Un adjunto que no se pudo bajar es un adjunto con un
 *   motivo escrito en la burbuja. Un webhook que devuelve 500 hace que el
 *   proveedor reintente y vuelva a disparar los flows: es mucho peor.
 * - **Una sola escritura.** Se bajan todos los adjuntos del mensaje y despues
 *   se guarda la columna entera. Un update por adjunto seria una carrera con el
 *   siguiente.
 * - **El interruptor del workspace manda.** Apagado, el item queda con la URL
 *   del proveedor como respaldo y `status: "none"`: no se baja nada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import {
  KINDS_WITH_FILE,
  type ChatAttachment,
  toAttachmentsColumn,
  normalizeMime,
} from "@/lib/messages/attachments";
import {
  CHAT_MEDIA_BUCKET,
  MAX_MEDIA_BYTES,
  TOO_LARGE_MESSAGE,
  mediaPath,
} from "@/lib/chat-media/bucket";

type Db = SupabaseClient<Database>;

/**
 * De donde salen los bytes de un adjunto.
 *
 * Instagram da una URL que se puede pedir con `fetch`. WhatsApp no: hay que
 * pedirle el archivo a Evolution, que lo devuelve en base64. Las dos formas
 * terminan en el mismo lugar, asi que el que sube no sabe de que canal viene.
 */
export type MediaSource =
  | { kind: "url"; url: string }
  | { kind: "bytes"; bytes: Uint8Array; mime: string | null }
  | { kind: "error"; message: string };

/** Como conseguir los bytes de un item. Devuelve un `error` en vez de lanzar. */
export type MediaFetcher = (item: ChatAttachment, index: number) => Promise<MediaSource>;

export interface StoreMediaResult {
  items: ChatAttachment[];
  /** Cuantos quedaron listos para reproducir. */
  stored: number;
  /** Cuantos fallaron. */
  failed: number;
}

/** El fetcher por defecto: bajar de la `sourceUrl` del item (Instagram). */
export function fetchFromSourceUrl(fetchImpl: typeof fetch = fetch): MediaFetcher {
  return async (item) => {
    if (!item.sourceUrl) return { kind: "error", message: "El adjunto llegó sin dirección de descarga" };
    return { kind: "url", url: item.sourceUrl };
  };
}

/**
 * Si el workspace quiere que copiemos la media.
 *
 * Se lee en cada mensaje con media, sin cachear: es un SELECT por clave
 * primaria sobre una tabla de una fila, y un interruptor que existe para
 * apagar algo en el momento tiene que apagarlo en el momento.
 */
export async function chatMediaEnabled(supabase: Db, workspaceId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("persist_chat_media")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("[inbound-media] no pude leer el interruptor de media:", error.message);
    // Ante la duda NO se baja: bajar sin permiso es peor que no bajar.
    return false;
  }
  return data?.persist_chat_media ?? true;
}

/**
 * Baja los archivos de un mensaje y los sube a `chat-media`.
 *
 * Devuelve los items actualizados; NO escribe la fila. Quien escribe es
 * `storeInboundMedia`, que es el que se usa desde los webhooks. Separado para
 * poder probar la parte de red sin una base.
 */
export async function downloadAttachments(args: {
  supabase: Db;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  items: ChatAttachment[];
  fetcher: MediaFetcher;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}): Promise<StoreMediaResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const maxBytes = args.maxBytes ?? MAX_MEDIA_BYTES;
  const items = args.items.map((item) => ({ ...item }));
  let stored = 0;
  let failed = 0;

  for (const [index, item] of items.entries()) {
    // Lo que no tiene archivo no se intenta bajar: una ubicacion o un contacto
    // dejarian el spinner girando para siempre.
    if (!KINDS_WITH_FILE.includes(item.kind)) continue;
    if (item.status !== "pending") continue;

    const markFailed = (message: string) => {
      item.status = "failed";
      item.error = message;
      failed++;
    };

    try {
      const source = await args.fetcher(item, index);

      if (source.kind === "error") {
        markFailed(source.message);
        continue;
      }

      let bytes: Uint8Array;
      let mime = item.mime;

      if (source.kind === "bytes") {
        bytes = source.bytes;
        mime = normalizeMime(source.mime) ?? mime;
      } else {
        const response = await fetchImpl(source.url);
        if (!response.ok) {
          markFailed(`El proveedor respondió ${response.status} al pedirle el archivo`);
          continue;
        }

        // El tamaño se chequea ANTES de leer el cuerpo cuando el proveedor lo
        // declara: un archivo de 300 MB no tiene por que entrar en memoria.
        const declared = Number(response.headers.get("content-length") ?? "");
        if (Number.isFinite(declared) && declared > maxBytes) {
          markFailed(TOO_LARGE_MESSAGE);
          continue;
        }

        bytes = new Uint8Array(await response.arrayBuffer());
        // El Content-Type del proveedor gana: el mime que declaro el mensaje
        // puede estar mal (WhatsApp manda nombres y tipos inventados).
        mime = normalizeMime(response.headers.get("content-type")) ?? mime;
      }

      if (bytes.byteLength === 0) {
        markFailed("El archivo llegó vacío");
        continue;
      }
      if (bytes.byteLength > maxBytes) {
        markFailed(TOO_LARGE_MESSAGE);
        continue;
      }

      const path = mediaPath({
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        index,
        mime,
      });

      const { error } = await args.supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .upload(path, bytes, { contentType: mime ?? "application/octet-stream", upsert: true });

      if (error) {
        // El motivo se loguea sin el path completo: no hace falta y es ruido.
        console.error("[inbound-media] no pude guardar el archivo:", error.message);
        markFailed("No pudimos guardar el archivo. Probá con Reintentar.");
        continue;
      }

      item.storagePath = path;
      item.mime = mime;
      item.sizeBytes = bytes.byteLength;
      item.status = "ready";
      item.error = null;
      stored++;
    } catch (err) {
      // Una caida de red, un timeout, un JSON roto: todo termina igual.
      console.error(
        "[inbound-media] error inesperado bajando un adjunto:",
        err instanceof Error ? err.message : "desconocido",
      );
      markFailed("No pudimos bajar el archivo. Probá con Reintentar.");
    }
  }

  return { items, stored, failed };
}

/**
 * Lo que usan los webhooks: baja los archivos y escribe la fila.
 *
 * El mensaje ya se inserto con los items en `pending`, asi que la burbuja
 * muestra "Descargando adjunto…" mientras esto corre.
 */
export async function storeInboundMedia(args: {
  supabase: Db;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  items: ChatAttachment[];
  fetcher?: MediaFetcher;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  /** Si ya se sabe que el workspace lo permite, para no volver a consultarlo. */
  enabled?: boolean;
}): Promise<StoreMediaResult> {
  const items = args.items.map((item) => ({ ...item }));
  if (items.length === 0) return { items, stored: 0, failed: 0 };

  try {
    const enabled = args.enabled ?? (await chatMediaEnabled(args.supabase, args.workspaceId));

    if (!enabled) {
      // Apagado: el item queda con lo que sabemos y sin archivo. No es un
      // fallo, asi que no se muestra ningun error; simplemente no hay nada que
      // reproducir, y en la burbuja se lee "Adjunto ya no disponible".
      const parked = items.map((item) => (item.status === "pending" ? { ...item, status: "none" as const } : item));
      await writeAttachments(args.supabase, args.messageId, parked);
      return { items: parked, stored: 0, failed: 0 };
    }

    const result = await downloadAttachments({
      supabase: args.supabase,
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      items,
      fetcher: args.fetcher ?? fetchFromSourceUrl(args.fetchImpl),
      fetchImpl: args.fetchImpl,
      maxBytes: args.maxBytes,
    });

    await writeAttachments(args.supabase, args.messageId, result.items);
    return result;
  } catch (err) {
    console.error(
      "[inbound-media] error inesperado guardando la media:",
      err instanceof Error ? err.message : "desconocido",
    );
    return { items, stored: 0, failed: 0 };
  }
}

/** Una sola escritura de la columna, al final. */
async function writeAttachments(supabase: Db, messageId: string, items: ChatAttachment[]): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .update({ attachments: toAttachmentsColumn(items) as never })
    .eq("id", messageId);

  if (error) {
    console.error("[inbound-media] no pude actualizar los adjuntos del mensaje:", error.message);
  }
}
