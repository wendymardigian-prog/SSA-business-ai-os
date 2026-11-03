/**
 * Los eventos del webhook de Resend que usa SSA, en UN solo lugar (conexion de Resend, R2).
 *
 * Sumar uno (por ejemplo `suppression.added` o `email.clicked`) es agregarlo aca: "Actualizar webhook" lo sincroniza
 * con Resend, y el receptor (`app/api/webhooks/resend-inbound`) tiene que saber que hacer con el. Puro: lo muestra
 * tambien la pantalla.
 */
export const RESEND_WEBHOOK_EVENTS_LIST = ["email.received", "email.bounced", "email.complained"] as const;

/** Para que sirve cada uno, en una linea (la pantalla). */
export const RESEND_EVENT_LABELS: Record<(typeof RESEND_WEBHOOK_EVENTS_LIST)[number], string> = {
  "email.received": "emails que te escriben (si la recepción está activa)",
  "email.bounced": "rebotes: la dirección no existe o no recibe",
  "email.complained": "quejas: alguien marcó tu email como spam",
};
