/**
 * Lo que el panel de un disparador muestra elegido antes de que la persona toque nada (puro, sirve en el navegador).
 *
 * El panel lo guarda al elegir el disparador y `buildDesiredTriggers` lo completa al publicar: antes se MOSTRABA sin
 * guardarse y el disparador no andaba (un evento de CRM sin evento, un recordatorio sin cuanto antes, una inactividad
 * sin ventana).
 */
const RELATIVE_DEFAULT = { offset_minutes: 1440 };

export function triggerConfigDefaults(type: string): Record<string, unknown> {
  switch (type) {
    case "crm_event":
      return { event: "tag_added" };
    case "inactivity":
      return { amount: 24, unit: "hours" };
    case "booking_before_start":
    case "booking_after_end":
    case "booking_after_created":
      return { ...RELATIVE_DEFAULT };
    default:
      return {};
  }
}
