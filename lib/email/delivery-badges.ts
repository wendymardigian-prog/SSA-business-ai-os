/**
 * Lo que paso con un email despues de salir (00287): las marcas que deja el webhook de Resend en su fila de
 * `email_log`. PURO: lo usan los resultados de un broadcast y el historial de la ficha del contacto.
 */

/** Lo que trae una fila de `email_log` sobre su entrega. */
export interface EmailDeliveryRow {
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  unsubscribed_at: string | null;
  open_count: number;
  click_count: number;
}

/** Las marcas, en orden: entregado (o rebotó), abrió, clic, spam, baja. Las aperturas son aproximadas. */
export function emailDeliveryBadges(row: EmailDeliveryRow | null | undefined): string[] {
  if (!row) return [];
  const out: string[] = [];
  if (row.bounced_at) out.push("Rebotó");
  else if (row.delivered_at) out.push("Entregado");
  if (row.opened_at) out.push(row.open_count > 1 ? `Abrió (${row.open_count})` : "Abrió");
  if (row.clicked_at) out.push(row.click_count > 1 ? `Clic (${row.click_count})` : "Clic");
  if (row.complained_at) out.push("Marcó spam");
  if (row.unsubscribed_at) out.push("Se dio de baja");
  return out;
}
