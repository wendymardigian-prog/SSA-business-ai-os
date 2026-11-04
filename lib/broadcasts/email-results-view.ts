/**
 * Los resultados de un broadcast por email (A9, la guardia de entrega 00287): entregados, abiertos (aproximado),
 * clics, rebotes, quejas y bajas que vinieron de ESE email, mas los pendientes por el tope del dia. PURO: lo usan la
 * pagina (servidor) y la tarjeta (navegador).
 *
 * Salen de `email_log` (cada envio de un broadcast es una fila con `related_entity_type = 'broadcast'`) y de los
 * eventos del webhook de Resend que llenan sus columnas. Un porcentaje sin base es «—», nunca 0.
 */

import { emailDeliveryBadges, type EmailDeliveryRow } from "@/lib/email/delivery-badges";

export interface EmailResultCounts {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
}

/** Lo que trae una fila de `email_log` de un destinatario (el mismo tipo que el historial del contacto). */
export type RecipientEmailRow = EmailDeliveryRow;

/** Los filtros de la lista por lo que paso con el email (`?email=`). */
export const EMAIL_RESULT_FILTERS = {
  entregado: { label: "Entregado", column: "delivered_at" },
  abrio: { label: "Abrió", column: "opened_at" },
  clic: { label: "Hizo clic", column: "clicked_at" },
  reboto: { label: "Rebotó", column: "bounced_at" },
  queja: { label: "Marcó spam", column: "complained_at" },
  baja: { label: "Se dio de baja", column: "unsubscribed_at" },
} as const;
export type EmailResultFilter = keyof typeof EMAIL_RESULT_FILTERS;

export function parseEmailResultFilter(raw: string | null | undefined): EmailResultFilter | "" {
  return raw && raw in EMAIL_RESULT_FILTERS ? (raw as EmailResultFilter) : "";
}

export interface ResultTile {
  key: keyof EmailResultCounts;
  label: string;
  value: number;
  /** Sobre lo enviado. «—» sin envios. */
  rate: string;
  hint?: string;
}

function rate(n: number, base: number): string {
  if (base <= 0) return "—";
  return `${((n / base) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
}

/** Las cifras de la tarjeta, en orden. PURO. */
export function emailResultTiles(c: EmailResultCounts): ResultTile[] {
  return [
    { key: "delivered", label: "Entregados", value: c.delivered, rate: rate(c.delivered, c.sent) },
    { key: "opened", label: "Abiertos", value: c.opened, rate: rate(c.opened, c.sent), hint: "Aproximado: depende de que el correo cargue las imágenes." },
    { key: "clicked", label: "Clics", value: c.clicked, rate: rate(c.clicked, c.sent) },
    { key: "bounced", label: "Rebotes", value: c.bounced, rate: rate(c.bounced, c.sent) },
    { key: "complained", label: "Quejas (spam)", value: c.complained, rate: rate(c.complained, c.sent) },
    { key: "unsubscribed", label: "Bajas de este email", value: c.unsubscribed, rate: rate(c.unsubscribed, c.sent) },
  ];
}

/** Las marcas de un destinatario (lo que paso con SU email). PURO. Las mismas que la ficha del contacto. */
export const recipientEmailBadges = emailDeliveryBadges;
