/**
 * Que reacciones admite cada canal (A3).
 *
 * Es el UNICO lugar que decide esto. Lo consultan el menu de la burbuja (para
 * ofrecer solo lo que se puede mandar), la accion del servidor (para rechazar
 * lo que llegue igual) y los tests. Si cada uno chequeara por su cuenta, la
 * bandeja terminaria ofreciendo una reaccion que el proveedor rechaza.
 *
 *   | canal                 | reacciones                                   |
 *   |-----------------------|----------------------------------------------|
 *   | WhatsApp (evolution)  | cualquier emoji (se ofrecen seis de entrada) |
 *   | Instagram (zernio)    | solo ❤️                                       |
 *   | email (resend)        | ninguna                                      |
 *
 * Instagram: la API de mensajes de Meta solo acepta el corazon ("love") como
 * reaccion de una cuenta de negocio. Se declara asi hasta comprobar en vivo que
 * Zernio deja mandar otros; ampliar la lista es cambiar UNA constante.
 *
 * La rama por proveedor es EXPLICITA, nunca un `else`: un canal nuevo que
 * cayera por default mandaria la reaccion al lugar equivocado sin avisar. Un
 * proveedor desconocido no ofrece reacciones.
 *
 * Puro.
 */

import { graphemeCount } from "@/lib/channels/text-limits";

export const WHATSAPP_QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export const INSTAGRAM_REACTIONS = ["❤️"] as const;

export interface ReactionCapability {
  supported: boolean;
  /** Las que se ofrecen de entrada. */
  quick: readonly string[];
  /** Si ademas se puede elegir cualquier otro emoji (el selector completo). */
  anyEmoji: boolean;
  /** Por que no, cuando no hay. */
  reason: string | null;
}

const NONE = (reason: string): ReactionCapability => ({ supported: false, quick: [], anyEmoji: false, reason });

export function reactionCapability(provider: string | null | undefined): ReactionCapability {
  switch (provider) {
    case "evolution":
      return { supported: true, quick: WHATSAPP_QUICK_REACTIONS, anyEmoji: true, reason: null };
    case "zernio":
      return { supported: true, quick: INSTAGRAM_REACTIONS, anyEmoji: false, reason: null };
    case "resend":
      return NONE("El email no admite reacciones.");
    default:
      return NONE("Este canal no admite reacciones.");
  }
}

export type ReactionCheck = { ok: true } | { ok: false; reason: string };

/** Si se puede reaccionar a ESTE mensaje por este canal. */
export function canReactToMessage(args: {
  provider: string | null | undefined;
  direction: "inbound" | "outbound";
  /** El id con el que el proveedor conoce el mensaje. Sin el no hay a que reaccionar. */
  platformMessageId: string | null | undefined;
}): ReactionCheck {
  const capability = reactionCapability(args.provider);
  if (!capability.supported) return { ok: false, reason: capability.reason ?? "Este canal no admite reacciones." };
  if (args.direction !== "inbound") return { ok: false, reason: "Solo se puede reaccionar a los mensajes que mandó el contacto." };
  if (!args.platformMessageId) return { ok: false, reason: "Este mensaje todavía no tiene un identificador del canal: probá en unos segundos." };
  return { ok: true };
}

/** Un solo emoji (un grafema), sin espacios. */
export function isSingleEmoji(value: string): boolean {
  const text = value.trim();
  return text.length > 0 && text.length <= 32 && graphemeCount(text) === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text);
}

/** Si este emoji se puede mandar por este canal. Vacio es "quitar la reaccion" y siempre se acepta si el canal admite reacciones. */
export function isAllowedReaction(provider: string | null | undefined, emoji: string): boolean {
  const capability = reactionCapability(provider);
  if (!capability.supported) return false;
  if (emoji === "") return true;
  if (!isSingleEmoji(emoji)) return false;
  return capability.anyEmoji || capability.quick.includes(emoji.trim());
}
