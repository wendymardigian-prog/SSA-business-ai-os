/**
 * A quién de la audiencia se le puede mandar por el canal elegido, y por qué no
 * a los demás. Puro: lo usan los conteos de la pantalla y la cola al confirmar,
 * así el número que se ve es el que se manda.
 *
 * WhatsApp (decisión del 3/11/2026): por defecto, solo quien ya tiene
 * conversación con ESE número (su id en el canal: teléfono o `@lid`). Con
 * "Sumar a los que solo tienen teléfono", también quien tiene un teléfono
 * cargado y nunca escribió: escribirle en frío a mucha gente es lo que más
 * bloqueos genera, por eso es opcional.
 *
 * Email: lo de marketing, con la misma regla que la puerta de suscripción
 * (`decideSend`). Al enviar se vuelve a mirar la DIRECCIÓN en todos los
 * contactos (`canSendEmailTo`); esto usa el estado del contacto para contar.
 */

import { normalizePhone } from "@/lib/phone";
import { decideSend, isEmailStatus } from "@/lib/email/subscription";

export type BroadcastChannelKind = "whatsapp" | "email";

export type AudienceSkipReason =
  | "do_not_contact"
  | "chat_unsubscribed"
  | "no_phone"
  | "phone_only_excluded"
  | "no_email"
  | "email_not_subscribed"
  | "email_unsubscribed"
  | "email_bounced"
  | "email_complained";

/** Los que aparecen además al enviar (no se pueden saber antes). */
export type SendSkipReason =
  | AudienceSkipReason
  | "missing_variables"
  | "phone_in_use"
  | "deleted"
  | "email_unverifiable"
  | "left_audience";

export const SKIP_REASON_LABELS: Record<SendSkipReason, string> = {
  do_not_contact: "Marcados como «no contactar»",
  chat_unsubscribed: "No reciben difusiones por chat",
  no_phone: "Sin teléfono",
  phone_only_excluded: "Solo tienen teléfono (nunca escribieron a este número)",
  no_email: "Sin email",
  email_not_subscribed: "Sin suscribir a emails",
  email_unsubscribed: "Dados de baja de los emails",
  email_bounced: "Su email rebota",
  email_complained: "Marcaron un email como spam",
  missing_variables: "Les falta un dato del mensaje",
  phone_in_use: "Su teléfono ya es de otro contacto en este número",
  deleted: "Contacto borrado",
  email_unverifiable: "No se pudo comprobar su email",
  left_audience: "Ya no tienen la etiqueta de la audiencia",
};

export interface AudienceContact {
  id: string;
  phone: string | null;
  whatsapp_phone: string | null;
  email: string | null;
  email_status: string | null;
  do_not_contact: boolean | null;
  is_subscribed: boolean | null;
}

export type Classification =
  | { ok: true; target: string; linked: boolean }
  | { ok: false; reason: AudienceSkipReason };

export interface ClassifyOptions {
  kind: BroadcastChannelKind;
  /** El id del contacto en ESTE número (`contact_channels.platform_sender_id`), si ya escribió. */
  linkedSenderId?: string | null;
  includePhoneOnly?: boolean;
}

const EMAIL_SKIP: Record<string, AudienceSkipReason> = {
  not_subscribed: "email_not_subscribed",
  unsubscribed: "email_unsubscribed",
  bounced: "email_bounced",
  complained: "email_complained",
};

export function classifyRecipient(c: AudienceContact, opts: ClassifyOptions): Classification {
  if (c.do_not_contact) return { ok: false, reason: "do_not_contact" };

  if (opts.kind === "whatsapp") {
    if (c.is_subscribed === false) return { ok: false, reason: "chat_unsubscribed" };
    if (opts.linkedSenderId) return { ok: true, target: opts.linkedSenderId, linked: true };
    const phone = normalizePhone(c.whatsapp_phone) ?? normalizePhone(c.phone);
    if (!phone) return { ok: false, reason: "no_phone" };
    if (!opts.includePhoneOnly) return { ok: false, reason: "phone_only_excluded" };
    return { ok: true, target: phone, linked: false };
  }

  const email = (c.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };
  const status = isEmailStatus(c.email_status) ? c.email_status : "subscribed";
  const skip = decideSend({ status, category: "marketing", doNotContact: false, honorDoNotContact: false });
  if (skip) return { ok: false, reason: EMAIL_SKIP[skip] ?? "email_unsubscribed" };
  return { ok: true, target: email, linked: true };
}

export interface ReachSummary {
  /** Contactos que dejaron los filtros. */
  total: number;
  /** A los que se les va a mandar. */
  sendable: number;
  /** WhatsApp: los que ya escribieron a este número. */
  linked: number;
  /** WhatsApp: los que solo tienen teléfono (se suman solo con la casilla). */
  phoneOnly: number;
  /** Los que quedan afuera, por motivo. Con la casilla apagada incluye `phone_only_excluded`. */
  skipped: Partial<Record<AudienceSkipReason, number>>;
}

export function emptyReach(): ReachSummary {
  return { total: 0, sendable: 0, linked: 0, phoneOnly: 0, skipped: {} };
}

/** Suma una clasificación al resumen. */
export function addToReach(summary: ReachSummary, c: Classification): ReachSummary {
  summary.total += 1;
  if (c.ok) {
    summary.sendable += 1;
    if (c.linked) summary.linked += 1;
    else summary.phoneOnly += 1;
  } else {
    summary.skipped[c.reason] = (summary.skipped[c.reason] ?? 0) + 1;
    if (c.reason === "phone_only_excluded") summary.phoneOnly += 1;
  }
  return summary;
}

/** El tope de una audiencia (contactos que dejan los filtros). */
export const MAX_AUDIENCE = 50_000;
