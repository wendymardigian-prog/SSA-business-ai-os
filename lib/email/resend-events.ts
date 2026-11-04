/**
 * Los eventos del webhook de Resend que usa SSA, en UN solo lugar (conexion de Resend, R2).
 *
 * Sumar uno (por ejemplo `suppression.added` o `email.clicked`) es agregarlo aca: "Actualizar webhook" lo sincroniza
 * con Resend, y el receptor (`app/api/webhooks/resend-inbound`) tiene que saber que hacer con el. Puro: lo muestra
 * tambien la pantalla.
 */
export const RESEND_WEBHOOK_EVENTS_LIST = [
  "email.received",
  "email.bounced",
  "email.complained",
  // Automatizaciones de email (00287): los resultados de cada envio (entregados, abiertos, clics).
  "email.delivered",
  "email.opened",
  "email.clicked",
] as const;

/**
 * Los imprescindibles: sin ellos no entran los emails y no hay freno. Si falta uno, el webhook se marca en rojo. Los
 * otros tres (entregas, aperturas y clics) son los resultados de cada envio: si faltan se sugiere sumarlos, pero no
 * es un error («Actualizar webhook» los agrega igual).
 */
export const RESEND_REQUIRED_EVENTS = ["email.received", "email.bounced", "email.complained"] as const;

/**
 * Los que necesita el freno automatico (00287): sin rebotes ni quejas, el freno no tiene con que decidir. La
 * pantalla avisa en rojo si el webhook esta desactivado o le falta alguno.
 */
export const BRAKE_REQUIRED_EVENTS = ["email.bounced", "email.complained"] as const;

/** Para que sirve cada uno, en una linea (la pantalla). */
export const RESEND_EVENT_LABELS: Record<(typeof RESEND_WEBHOOK_EVENTS_LIST)[number], string> = {
  "email.received": "emails que te escriben (si la recepción está activa)",
  "email.bounced": "rebotes: la dirección no existe o no recibe",
  "email.complained": "quejas: alguien marcó tu email como spam",
  "email.delivered": "entregas: el email llegó al servidor de la persona",
  "email.opened": "aperturas (aproximadas: dependen de que se carguen las imágenes)",
  "email.clicked": "clics en los links del email",
};
