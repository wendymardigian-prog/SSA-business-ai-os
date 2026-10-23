/**
 * Manda (o quita) una reaccion a un mensaje por el proveedor del canal (A3).
 *
 * Una sola puerta: quien reacciona (la accion del servidor) no sabe si el
 * canal es WhatsApp por Evolution o Instagram por Zernio. La rama por
 * proveedor es EXPLICITA, nunca un `else`: un canal nuevo que cayera por
 * default en Zernio mandaria la reaccion al lugar equivocado sin avisar.
 *
 * Las claves se leen con el cliente de servicio (`secrets`): desde la 00143
 * `read_secret` solo la ejecuta `service_role`. Quien llama ya chequeo que la
 * persona puede responder por este canal.
 *
 * Un error del proveedor vuelve como `{ ok: false, message }` ya traducido, sin
 * datos del contacto ni el contenido del mensaje. Nunca lanza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { canReactToMessage, isAllowedReaction } from "@/lib/channels/reactions";
import { EvolutionError, sendReaction as evolutionSendReaction } from "@/lib/evolution-client";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { createZernioClient } from "@/lib/zernio-client";
import { describeSendError } from "@/lib/instagram-errors";
import { zernioStatus } from "@/lib/publishing/zernio-errors";

type Db = SupabaseClient<Database>;

export interface ReactionTarget {
  workspaceId: string;
  channelId: string;
  contactId: string;
  /** La conversacion de Zernio (`conversations.late_conversation_id`); solo Instagram. */
  lateConversationId: string | null;
  direction: "inbound" | "outbound";
  platformMessageId: string | null;
  /** El id nativo de Meta, cuando se conoce: Zernio puede conocer el mensaje por cualquiera de los dos. */
  platformNativeMessageId?: string | null;
}

export type SendReactionResult = { ok: true } | { ok: false; message: string; retryable: boolean };

interface ChannelRow {
  id: string;
  provider: string;
  platform: string;
  late_account_id: string | null;
  evolution_instance: string | null;
  is_active: boolean;
  workspace_id: string;
}

const fail = (message: string, retryable = false): SendReactionResult => ({ ok: false, message, retryable });

/** Los ids con los que se prueba un mensaje en Zernio, sin repetir y sin vacios. */
export function zernioMessageIds(target: Pick<ReactionTarget, "platformMessageId" | "platformNativeMessageId">): string[] {
  return [...new Set([target.platformNativeMessageId, target.platformMessageId].filter((id): id is string => typeof id === "string" && id !== ""))];
}

/** `emoji` vacio quita la reaccion. */
export async function sendReactionToProvider(args: {
  supabase: Db;
  secrets: Db;
  target: ReactionTarget;
  emoji: string;
}): Promise<SendReactionResult> {
  const { supabase, secrets, target } = args;

  const { data } = await supabase
    .from("channels")
    .select("id, provider, platform, late_account_id, evolution_instance, is_active, workspace_id")
    .eq("id", target.channelId)
    .eq("workspace_id", target.workspaceId)
    .maybeSingle();
  const channel = data as ChannelRow | null;
  if (!channel) return fail("No se encontró el canal de la conversación.");
  if (!channel.is_active) return fail("El canal está desconectado: reconectalo desde Canales para poder reaccionar.");

  const check = canReactToMessage({ provider: channel.provider, direction: target.direction, platformMessageId: target.platformMessageId });
  if (!check.ok) return fail(check.reason);
  if (!isAllowedReaction(channel.provider, args.emoji)) {
    return fail(args.emoji ? "Este canal no admite esa reacción." : "No hay una reacción para quitar.");
  }

  if (channel.provider === "evolution") return reactViaEvolution(supabase, secrets, channel, target, args.emoji);
  if (channel.provider === "zernio") return reactViaZernio(secrets, channel, target, args.emoji);
  // Un proveedor sin reacciones (email) ya se rechazo arriba; esto es por si se suma uno y se olvida la rama.
  return fail("Este canal no admite reacciones.");
}

async function reactViaEvolution(supabase: Db, secrets: Db, channel: ChannelRow, target: ReactionTarget, emoji: string): Promise<SendReactionResult> {
  const config = await getEvolutionConfig(secrets, channel.workspace_id);
  if (!config || !channel.evolution_instance) return fail("WhatsApp no está configurado en este entorno.");

  const { data: link } = await supabase
    .from("contact_channels")
    .select("platform_sender_id")
    .eq("channel_id", channel.id)
    .eq("contact_id", target.contactId)
    .maybeSingle();
  if (!link?.platform_sender_id) return fail("Este contacto no tiene un número de WhatsApp vinculado.");

  try {
    await evolutionSendReaction(config, channel.evolution_instance, {
      to: link.platform_sender_id,
      messageId: target.platformMessageId as string,
      // Solo se reacciona a mensajes del contacto (`canReactToMessage`).
      fromMe: false,
      reaction: emoji,
    });
    return { ok: true };
  } catch (err) {
    // No se loguea el error crudo: puede traer el telefono. Alcanza con el codigo.
    console.error(`[reaction] WhatsApp rechazó la reacción (${err instanceof EvolutionError ? (err.status ?? "sin codigo") : "error"})`);
    if (err instanceof EvolutionError && (err.status === 404 || err.status === 400)) {
      return fail("WhatsApp no encontró ese mensaje: puede ser muy viejo o haberse borrado.");
    }
    return fail("WhatsApp no pudo recibir la reacción. Probá de nuevo en un momento.", true);
  }
}

async function reactViaZernio(secrets: Db, channel: ChannelRow, target: ReactionTarget, emoji: string): Promise<SendReactionResult> {
  const apiKey = await getZernioApiKey(channel.workspace_id, { supabase: secrets });
  if (!apiKey) return fail("La cuenta de Instagram no está conectada.");
  if (!channel.late_account_id || !target.lateConversationId) return fail("Todavía no hay una conversación abierta con este contacto en Instagram.");

  const zernio = createZernioClient(apiKey);
  let lastError: unknown = null;
  // Zernio conoce el mensaje por su id nativo de Meta o por el propio; si uno no lo encuentra (404), se prueba el otro.
  for (const messageId of zernioMessageIds(target)) {
    try {
      if (emoji === "") {
        await zernio.messages.removeMessageReaction({
          path: { conversationId: target.lateConversationId, messageId },
          query: { accountId: channel.late_account_id },
        });
      } else {
        await zernio.messages.addMessageReaction({
          path: { conversationId: target.lateConversationId, messageId },
          body: { accountId: channel.late_account_id, emoji },
        });
      }
      return { ok: true };
    } catch (err) {
      lastError = err;
      if (zernioStatus(err) !== 404) break;
    }
  }
  const failure = describeInstagramReactionError(lastError);
  console.error(`[reaction] Instagram rechazó la reacción (${failure.kind}, ${zernioStatus(lastError) ?? "sin codigo"})`);
  return fail(failure.message, failure.retryable);
}

/**
 * Por que Instagram no tomo la reaccion, en palabras de la bandeja.
 *
 * Se apoya en `describeSendError` (el mismo motivo que un texto) pero con un
 * texto propio: "No se pudo enviar el mensaje" confundia, porque la persona no
 * mando ningun mensaje. Puro.
 */
export function describeInstagramReactionError(error: unknown): { kind: string; message: string; retryable: boolean } {
  const status = zernioStatus(error);
  if (status === 404) {
    return { kind: "not_found", message: "Instagram no encontró ese mensaje: puede ser muy viejo o haberse borrado.", retryable: false };
  }
  const failure = describeSendError(error);
  switch (failure.kind) {
    case "not_thread_owner":
      return {
        kind: failure.kind,
        message:
          "Instagram no deja reaccionar acá: esta conversación la está manejando otra app conectada a tu cuenta (por ejemplo ManyChat). Mientras la tenga esa app, el sistema no puede responder ni reaccionar. Reaccioná desde la app de Instagram o desde esa otra app.",
        retryable: false,
      };
    case "outside_window":
      return {
        kind: failure.kind,
        message: "Instagram solo deja reaccionar dentro de las 24 horas desde el último mensaje del contacto. Cuando vuelva a escribir, vas a poder.",
        retryable: false,
      };
    case "rate_limited":
      return { kind: failure.kind, message: "Instagram está frenando los envíos de la cuenta por un rato. Probá reaccionar de nuevo en unos minutos.", retryable: true };
    case "user_unavailable":
      return { kind: failure.kind, message: "Este contacto no está recibiendo mensajes en Instagram, así que tampoco reacciones.", retryable: false };
    case "token_expired":
      return { kind: failure.kind, message: "La conexión con Instagram dejó de ser válida: reconectala desde Canales para poder reaccionar.", retryable: false };
    case "policy_violation":
      return { kind: failure.kind, message: "Instagram no aceptó la reacción por sus reglas de uso.", retryable: false };
    case "unknown":
      break;
  }
  if (status === 403) {
    return { kind: "forbidden", message: "Tu plan de Zernio no incluye la bandeja de mensajes, y sin eso Instagram no deja reaccionar.", retryable: false };
  }
  if (status === 400) {
    return { kind: "rejected", message: "Instagram no aceptó esa reacción para este mensaje.", retryable: false };
  }
  return {
    kind: "unknown",
    message: "Instagram no tomó la reacción. Probá de nuevo en un momento; si se repite, reaccioná desde la app de Instagram.",
    retryable: true,
  };
}
