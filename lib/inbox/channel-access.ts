/**
 * La bandeja por CUENTA conectada (00249). Puro: lo usan la lista, el menú de cuentas, el envío, los
 * borradores del agente y las reacciones.
 *
 * Cada rol dice, cuenta por cuenta (o para todas, incluidas las futuras), qué conversaciones ve y si
 * puede responder (`RolePermissions.channels`, `lib/auth/channel-permissions.ts`). CUÁLES conversaciones
 * de esa cuenta (solo asignadas, + sin asignar, todas) lo aplica la RLS (`can_see_conversation`); acá
 * solo se decide qué cuentas se piden y dónde aparece el composer.
 */
import { grantFor, hasAnyChannel, type ChannelRef } from "@/lib/auth/channel-permissions";
import type { RolePermissions } from "@/lib/auth/permissions";

type Perms = Pick<RolePermissions, "channels"> | null | undefined;

/** Si ve alguna conversación de esa cuenta. */
export function canViewChannel(perms: Perms, channelId: string | null | undefined): boolean {
  return grantFor(perms?.channels, channelId) !== null;
}

/** Si puede escribir en las conversaciones de esa cuenta. */
export function canReplyChannel(perms: Perms, channelId: string | null | undefined): boolean {
  return grantFor(perms?.channels, channelId)?.reply === true;
}

/** Si la bandeja aparece en el menú: ve al menos una cuenta. */
export function canUseInbox(perms: Perms): boolean {
  return hasAnyChannel(perms?.channels);
}

/** Las cuentas (de esta lista) cuyas conversaciones ve. */
export function visibleChannelIds(perms: Perms, channels: ChannelRef[]): string[] {
  return channels.filter((c) => canViewChannel(perms, c.id)).map((c) => c.id);
}

/**
 * Donde puede responder, para la pantalla: `null` si responde en todas las cuentas que ve, o los ids de
 * las cuentas donde responde (vacía = en ninguna).
 */
export function replyFilterFor(perms: Perms): string[] | null {
  if (!perms) return [];
  if (perms.channels.mode === "all") return perms.channels.all.reply ? null : [];
  return Object.entries(perms.channels.byChannel)
    .filter(([, grant]) => grant.reply)
    .map(([id]) => id);
}

/**
 * Las cuentas que se le piden a la consulta de la bandeja: `null` si ve todas (no hace falta filtrar), o
 * los ids de las que ve (vacía = ninguna). Sale de la configuración, no de la lista de cuentas activas:
 * una cuenta desconectada sigue mostrando sus conversaciones viejas a quien la tiene.
 */
export function channelFilterFor(perms: Perms): string[] | null {
  if (!perms) return [];
  if (perms.channels.mode === "all") return null;
  return Object.keys(perms.channels.byChannel);
}
