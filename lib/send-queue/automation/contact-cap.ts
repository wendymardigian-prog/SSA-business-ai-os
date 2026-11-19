/**
 * Tope de WhatsApp automáticos por contacto y día, sumando todas las automatizaciones. PURO.
 *
 * Decisión de producto (18/11/2026): se trae APAGADO. Se prende en la pantalla de la cola. Prendido, lo previsto es 3 al
 * día por contacto y, aparte, 3 al día por grupo; lo urgente no cuenta (ni suma ni se frena). Solo cuenta lo que pasa por
 * la cola: lo que sale al instante (las respuestas a quien acaba de escribir y los avisos de agenda) no. El día es el
 * del negocio (`workspaces.timezone`). Se guarda en `workspaces.send_contact_caps` (00420); null = apagado.
 *
 * Lo que pasa del tope queda «descartado por tope» con su motivo: no espera al día siguiente, porque un mensaje automático
 * de ayer suele perder el sentido.
 */
import type { SendQueuePriority } from "@/lib/types/database";

export interface ContactCapPolicy {
  enabled: boolean;
  /** Mensajes automáticos al día por contacto (null = sin tope). */
  perContactDay: number | null;
  /** Mensajes automáticos al día por grupo (null = sin tope). */
  perGroupDay: number | null;
  /** ¿Lo urgente cuenta y se frena? Previsto: no. */
  urgentCounts: boolean;
}

export const DEFAULT_CONTACT_CAP: ContactCapPolicy = { enabled: false, perContactDay: 3, perGroupDay: 3, urgentCounts: false };

const MAX_CAP = 50;

function cap(v: unknown, fallback: number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_CAP, Math.max(1, Math.round(n)));
}

/** Lo guardado. Nunca lanza: lo raro vuelve al valor previsto. Sin guardar (null) = apagado. */
export function parseContactCap(raw: unknown): ContactCapPolicy {
  const p = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!p) return DEFAULT_CONTACT_CAP;
  return {
    enabled: p.enabled === true,
    perContactDay: "perContactDay" in p ? cap(p.perContactDay, DEFAULT_CONTACT_CAP.perContactDay) : DEFAULT_CONTACT_CAP.perContactDay,
    perGroupDay: "perGroupDay" in p ? cap(p.perGroupDay, DEFAULT_CONTACT_CAP.perGroupDay) : DEFAULT_CONTACT_CAP.perGroupDay,
    urgentCounts: typeof p.urgentCounts === "boolean" ? p.urgentCounts : DEFAULT_CONTACT_CAP.urgentCounts,
  };
}

/** Lo que llega de la pantalla. Un tope vacío es «sin tope» para ese tipo. */
export function contactCapInput(input: unknown): { ok: true; value: ContactCapPolicy } | { ok: false; error: string } {
  const r = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!r) return { ok: false, error: "Faltan los datos del tope." };
  const read = (v: unknown, what: string): { ok: true; value: number | null } | { ok: false; error: string } => {
    if (v === null || v === undefined || v === "") return { ok: true, value: null };
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CAP) return { ok: false, error: `El tope ${what} tiene que ser un número entero entre 1 y ${MAX_CAP}.` };
    return { ok: true, value: n };
  };
  const contact = read(r.perContactDay, "por contacto");
  if (!contact.ok) return contact;
  const group = read(r.perGroupDay, "por grupo");
  if (!group.ok) return group;
  return { ok: true, value: { enabled: r.enabled === true, perContactDay: contact.value, perGroupDay: group.value, urgentCounts: r.urgentCounts === true } };
}

export type CapTarget = "contact" | "group";

/** ¿Este envío pasa el tope de su contacto (o grupo) hoy? `sentToday`: lo automático que ya salió hoy y cuenta. */
export function contactCapDecision(
  policy: ContactCapPolicy,
  target: CapTarget,
  priority: SendQueuePriority,
  sentToday: number,
): { ok: true } | { ok: false; reason: string } {
  if (!policy.enabled) return { ok: true };
  if (priority === "urgent" && !policy.urgentCounts) return { ok: true };
  const limit = target === "group" ? policy.perGroupDay : policy.perContactDay;
  if (limit === null || sentToday < limit) return { ok: true };
  return {
    ok: false,
    reason:
      target === "group"
        ? `El grupo ya recibió ${sentToday} mensajes automáticos hoy (tope ${limit}): no se envió.`
        : `El contacto ya recibió ${sentToday} mensajes automáticos hoy (tope ${limit}): no se envió.`,
  };
}
