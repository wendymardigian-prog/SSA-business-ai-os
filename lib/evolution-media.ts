/**
 * La media de WhatsApp (F4).
 *
 * WhatsApp no manda el archivo: manda un nodo de Baileys cuya `url` es un `.enc`
 * cifrado. Sin la `mediaKey` no se puede abrir, y la `mediaKey` no se guarda.
 * El unico que puede descifrarlo es Evolution, que tiene la sesion, asi que hay
 * que pedirselo por el id del mensaje.
 *
 * De paso arregla el bug que perdia la media: hasta ahora el receptor guardaba
 * `attachments: text ? null : data.message`, y como `extractText` devuelve el
 * `caption` de una imagen, **una foto con texto se guardaba sin la foto**.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getBase64FromMediaMessage, EvolutionError, type EvolutionConfig } from "@/lib/evolution-client";
import { fromBaileysMessage, type ChatAttachment } from "@/lib/messages/attachments";
import { storeInboundMedia, type MediaFetcher, type StoreMediaResult } from "@/lib/inbound-media";

type Db = SupabaseClient<Database>;

/**
 * Los adjuntos de un mensaje de WhatsApp, normalizados y sin archivo todavia.
 *
 * Es `fromBaileysMessage` con otro nombre, exportado aparte para que el receptor
 * no tenga que saber que atras hay un nodo de Baileys.
 */
export function describeWhatsappMessage(message: Record<string, unknown> | null | undefined): ChatAttachment[] {
  return fromBaileysMessage(message);
}

/**
 * Lo que hay que mandarle a Evolution para pedir el archivo: el `WebMessageInfo`
 * de Baileys, o sea `{ key, message }`.
 *
 * **No alcanza con `data.message`** (el contenido, `{ audioMessage }`): Evolution
 * 2.3.7 hace `m?.message ? m : getMessage(m.key)`, y con el contenido solo no hay
 * ni `message` ni `key` y contesta 400. Ese fue el bug del 1/10 al 20/11/2026: casi
 * ninguna nota de voz ni foto de WhatsApp se podia bajar.
 *
 * Devuelve null si falta el id del mensaje o su contenido.
 */
export function whatsappWebMessage(
  data: { key?: object | null; message?: Record<string, unknown> | null } | null | undefined,
): Record<string, unknown> | null {
  const key = data?.key as { id?: unknown } | null | undefined;
  const id = key && typeof key.id === "string" && key.id.length > 0 ? key.id : null;
  if (!key || !id || !data?.message) return null;
  return { key, message: data.message };
}

/** Lo que se le pide a Evolution: el mensaje entero (webhook) o solo su id (reintento). */
export type EvolutionMediaSource =
  | { webMessage: Record<string, unknown> | null }
  | { messageKeyId: string };

/** El texto de un archivo que ya no se puede traer. `isRetryableMediaError` lo reconoce: sin boton. */
export const WHATSAPP_MEDIA_GONE = "WhatsApp ya no tiene este archivo disponible";

/**
 * El fetcher de WhatsApp: le pide a Evolution el archivo en base64.
 *
 * Todos los adjuntos de un mensaje comparten el id, asi que Evolution devuelve
 * el mismo archivo para los dos si hubiera dos. En la practica un mensaje de
 * WhatsApp trae un solo adjunto; el pedido se hace igual por item para no
 * asumirlo, y la respuesta se guarda para no pedir dos veces lo mismo.
 *
 * Con el mensaje entero (`webMessage`) Evolution lo descifra directo. Con el id
 * solo (`messageKeyId`, el reintento) lo busca en su propia base: si no lo tiene,
 * contesta 400 y eso ya no tiene arreglo.
 */
export function evolutionMediaFetcher(
  args: { config: EvolutionConfig; instance: string } & EvolutionMediaSource,
): MediaFetcher {
  let cached: { base64: string; mime: string | null } | null = null;
  const byKey = "messageKeyId" in args;
  const request: Record<string, unknown> | null = byKey ? { key: { id: args.messageKeyId } } : args.webMessage;

  return async () => {
    if (!request) {
      return { kind: "error", message: "El mensaje llegó sin identificador, así que no puedo pedir el archivo" };
    }

    try {
      if (!cached) {
        const payload = await getBase64FromMediaMessage(args.config, args.instance, request);
        if (!payload) {
          // Evolution contesto bien y no tiene el archivo: WhatsApp ya lo borro
          // de su servidor. No es reintentable.
          return { kind: "error", message: WHATSAPP_MEDIA_GONE };
        }
        cached = { base64: payload.base64, mime: payload.mimetype };
      }

      const bytes = Uint8Array.from(Buffer.from(cached.base64, "base64"));
      if (bytes.byteLength === 0) {
        return { kind: "error", message: "El archivo llegó vacío" };
      }

      return { kind: "bytes", bytes, mime: cached.mime };
    } catch (err) {
      if (err instanceof EvolutionError) {
        // Pidiendo por id, un 400 es que Evolution no tiene ese mensaje guardado o
        // WhatsApp ya borro el archivo: otro reintento no lo cambia.
        if (byKey && err.status === 400) {
          return { kind: "error", message: WHATSAPP_MEDIA_GONE };
        }
        // El estado de Evolution se muestra, sin el cuerpo entero.
        return {
          kind: "error",
          message: `No pudimos traer el archivo de WhatsApp (Evolution respondió ${err.status ?? "sin estado"})`,
        };
      }
      return { kind: "error", message: "No pudimos traer el archivo de WhatsApp. Probá con Reintentar." };
    }
  };
}

/**
 * Baja los archivos de un mensaje de WhatsApp y los guarda.
 *
 * Nunca lanza: va dentro del `after()` del webhook, que ya respondio 200.
 */
export async function storeEvolutionMedia(args: {
  supabase: Db;
  config: EvolutionConfig;
  instance: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  /** El `{ key, message }` del webhook (`whatsappWebMessage(data)`), no `data.message` solo. */
  webMessage: Record<string, unknown> | null;
  items: ChatAttachment[];
}): Promise<StoreMediaResult> {
  return storeInboundMedia({
    supabase: args.supabase,
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    messageId: args.messageId,
    items: args.items,
    fetcher: evolutionMediaFetcher({
      config: args.config,
      instance: args.instance,
      webMessage: args.webMessage,
    }),
  });
}
