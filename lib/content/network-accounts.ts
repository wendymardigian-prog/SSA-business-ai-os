/**
 * La cuenta principal de cada red de una pieza y sus colaboradores (varias cuentas de la misma red, 00236).
 *
 * `networks[].account_id` es la cuenta desde la que se publica. En Instagram la publicacion puede ademas salir como
 * COLABORACION con hasta 3 usuarios (`options.collaborators`): la cuenta principal es la que publica y las otras
 * reciben la invitacion de Instagram. Solo feed y Reels (lo dice Zernio).
 *
 * Modulo PURO.
 */

import type { NetworkEntry } from "./redistribution";

/** Instagram admite hasta 3 colaboradores por publicacion. */
export const MAX_COLLABORATORS = 3;

/** Los formatos de Instagram que admiten colaboradores. */
export const COLLABORATION_FORMATS = ["reel", "image", "carousel"] as const;

const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

/** "@Marca.Academia " -> "marca.academia", o null si no es un usuario de Instagram valido. */
export function cleanUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^@+/, "").toLowerCase();
  return USERNAME.test(value) ? value : null;
}

/** La lista de colaboradores limpia: usuarios validos, sin repetidos y como mucho 3. Nunca lanza. */
export function cleanCollaborators(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const user = cleanUsername(item);
    if (user && !out.includes(user)) out.push(user);
    if (out.length >= MAX_COLLABORATORS) break;
  }
  return out;
}

/** Si un formato de Instagram admite colaboradores (las historias no). Sin formato elegido, se deja pasar. */
export function formatAllowsCollaborators(format: string | null | undefined): boolean {
  return !format || (COLLABORATION_FORMATS as readonly string[]).includes(format);
}

/**
 * Que las cuentas elegidas en las redes sean de este workspace, activas y de la misma red. Devuelve el mensaje
 * para mostrar, o null si esta todo bien. Una red sin `account_id` no se mira (usa la cuenta de siempre).
 */
export function checkNetworkAccounts(
  networks: Array<Pick<NetworkEntry, "platform" | "account_id">>,
  accounts: Array<{ id: string; platform: string; is_active?: boolean | null }>,
): string | null {
  for (const network of networks) {
    if (!network.account_id) continue;
    const account = accounts.find((a) => a.id === network.account_id);
    if (!account || account.is_active === false) {
      return `La cuenta elegida para ${network.platform} ya no existe o esta desconectada. Elegi otra.`;
    }
    if (account.platform !== network.platform) {
      return `La cuenta elegida no es de ${network.platform}.`;
    }
  }
  return null;
}

// ── Lo que muestra el editor ───────────────────────────────────────────────

export interface EditorAccount {
  id: string;
  platform: string;
  label: string;
  channelId: string | null;
  defaultPublisher: string | null;
  publishers: string[];
}

export interface NetworkAccountView {
  /** Las cuentas entre las que se elige. Vacio con una sola (o ninguna): no hay nada que elegir. */
  options: Array<{ id: string; label: string }>;
  /** La cuenta con la que saldria esta red: la elegida o, sin eleccion, la de siempre. */
  effective: EditorAccount | null;
  /** Hay una cuenta elegida que ya no esta conectada: se avisa en vez de cambiarla en silencio. */
  stale: boolean;
}

/** La cuenta principal de una red para el editor. Las cuentas llegan con la mas antigua primero. */
export function networkAccountView(
  accounts: EditorAccount[],
  network: Pick<NetworkEntry, "platform" | "account_id">,
): NetworkAccountView {
  const list = accounts.filter((a) => a.platform === network.platform);
  const chosen = network.account_id ? list.find((a) => a.id === network.account_id) : undefined;
  const fallback = list.find((a) => a.defaultPublisher) ?? list[0] ?? null;
  return {
    options: list.length > 1 ? list.map((a) => ({ id: a.id, label: a.label })) : [],
    effective: chosen ?? fallback,
    stale: Boolean(network.account_id && !chosen),
  };
}

/** Los colaboradores como se escriben en el campo: "uno, dos". */
export function collaboratorsToText(raw: unknown): string {
  return cleanCollaborators(raw).join(", ");
}

/** Lo que se escribio en el campo, como lista limpia (separa por coma, espacio o salto de linea). */
export function textToCollaborators(text: string): string[] {
  return cleanCollaborators(text.split(/[\s,;]+/));
}
