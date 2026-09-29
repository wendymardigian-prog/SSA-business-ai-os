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
 * El fetcher de WhatsApp: le pide a Evolution el archivo en base64.
 *
 * Todos los adjuntos de un mensaje comparten el id, asi que Evolution devuelve
 * el mismo archivo para los dos si hubiera dos. En la practica un mensaje de
 * WhatsApp trae un solo adjunto; el pedido se hace igual por item para no
 * asumirlo, y la respuesta se guarda para no pedir dos veces lo mismo.
 */
export function evolutionMediaFetcher(args: {
  config: EvolutionConfig;
  instance: string;
  platformMessageId: string | null;
}): MediaFetcher {
  let cached: { base64: string; mime: string | null } | null = null;

  return async () => {
    if (!args.platformMessageId) {
      return { kind: "error", message: "El mensaje llegó sin identificador, así que no puedo pedir el archivo" };
    }

    try {
      if (!cached) {
        const payload = await getBase64FromMediaMessage(args.config, args.instance, args.platformMessageId);
        if (!payload) {
          // Evolution contesto bien y no tiene el archivo: WhatsApp ya lo borro
          // de su servidor. No es reintentable.
          return { kind: "error", message: "WhatsApp ya no tiene este archivo disponible" };
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
  platformMessageId: string | null;
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
      platformMessageId: args.platformMessageId,
    }),
  });
}
