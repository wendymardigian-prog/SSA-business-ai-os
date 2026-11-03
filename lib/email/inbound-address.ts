/**
 * A que negocio y a que direccion llego un email (conexion de Resend, R4: recepcion por dominio).
 *
 * Resend recibe en CUALQUIER direccion del dominio; el canal de email del negocio guarda la direccion principal
 * (`hola@dominio`), y el dominio sale de ahi. Las reglas, en orden:
 *
 * 1. Una direccion que es EXACTAMENTE la de un canal gana (lo de siempre).
 * 2. Si no, el dominio: la primera direccion del correo cuyo dominio es el de un canal activo.
 * 3. Dos negocios con el mismo dominio y ninguna direccion exacta: no se adivina (`ambiguous`). Con `?w=` en la URL
 *    del webhook el receptor ni llega aca: ya sabe el negocio.
 *
 * Puro: lo usan el receptor y el envio de la respuesta.
 */

import { bareAddress } from "./reply";

/** El dominio de una direccion ("Ana <ana@X.com>" → "x.com"), o null. */
export function domainOf(address: string | null | undefined): string | null {
  const bare = bareAddress(address);
  if (!bare) return null;
  const at = bare.lastIndexOf("@");
  const domain = bare.slice(at + 1);
  return domain.includes(".") ? domain : null;
}

/** Todas las direcciones a las que fue el correo (para, copia y copia oculta), sin repetir y en minusculas. */
export function inboundRecipients(params: { to?: string[] | null; cc?: string[] | null; receivedFor?: string[] | null }): string[] {
  const all = [...(params.to ?? []), ...(params.cc ?? []), ...(params.receivedFor ?? [])];
  return [...new Set(all.map((a) => bareAddress(a)).filter((a): a is string => Boolean(a)))];
}

/** La primera direccion del correo que es del dominio (o null). */
export function pickOurAddress(recipients: string[], domain: string | null): string | null {
  if (!domain) return null;
  return recipients.find((a) => domainOf(a) === domain) ?? null;
}

export interface InboundChannelRef {
  id: string;
  workspace_id: string;
  email_address: string | null;
}

export type InboundResolution =
  | { kind: "found"; channel: InboundChannelRef; address: string }
  | { kind: "unknown" }
  | { kind: "ambiguous"; workspaceIds: string[] };

/** De que canal es un correo, entre los canales de email activos de la instalacion. */
export function resolveInboundChannel(recipients: string[], channels: InboundChannelRef[]): InboundResolution {
  const usable = channels.filter((c) => bareAddress(c.email_address));

  for (const address of recipients) {
    const exact = usable.find((c) => bareAddress(c.email_address) === address);
    if (exact) return { kind: "found", channel: exact, address };
  }

  for (const address of recipients) {
    const domain = domainOf(address);
    const matches = usable.filter((c) => domainOf(c.email_address) === domain);
    const workspaces = [...new Set(matches.map((c) => c.workspace_id))];
    if (workspaces.length === 1) return { kind: "found", channel: matches[0], address };
    if (workspaces.length > 1) return { kind: "ambiguous", workspaceIds: workspaces };
  }

  return { kind: "unknown" };
}

/**
 * Desde que direccion se responde: la misma a la que escribio la persona (mantiene el hilo y es lo esperable), si es
 * del dominio del canal. Si no hay ninguna (alguien escribe primero desde la bandeja, o el hilo es de antes), la
 * principal del canal. Nunca una direccion de otro dominio: Resend solo manda desde dominios verificados.
 */
export function replyFromAddress(lastInbound: { to?: string[] | null; cc?: string[] | null } | null, channelAddress: string): string {
  const own = bareAddress(channelAddress) ?? channelAddress;
  if (!lastInbound) return own;
  return pickOurAddress(inboundRecipients({ to: lastInbound.to, cc: lastInbound.cc }), domainOf(own)) ?? own;
}

/** "para: soporte@…" en la bandeja: a cual de nuestras direcciones llego (la del dominio del canal; si no, la primera). Puro. */
export function inboundToLabel(emailTo: unknown, channelAddress: string | null): string | null {
  const list = Array.isArray(emailTo) ? emailTo.filter((a): a is string => typeof a === "string") : [];
  const domain = domainOf(channelAddress);
  const ours = domain ? pickOurAddress(inboundRecipients({ to: list }), domain) : null;
  return ours ?? (list.length > 0 ? bareAddress(list[0]) : null);
}
