// @plantilla-quitar(servicios)
/**
 * Los disparadores del modulo en Automatizaciones (F25, F117). Modulo puro: tipos, etiquetas, filtros
 * y la clave de idempotencia. El registro (`lib/flow-engine/registry/service-triggers.ts`) solo los
 * declara.
 *
 * Los eventos los emite la base (`app_servicio.emit`): solo escalares, nunca `booking_id`. Los del
 * servicio llevan `service_id`, `product_id`, `variant_id` y, segun el caso, `phase_key` e `item_key`
 * (los filtros de los workflows del camino, F117).
 */

export const SERVICE_TRIGGER_TYPES = [
  "service_created",
  "service_started",
  "service_ending_soon",
  "service_status_changed",
  "service_extended",
  "service_paused",
  "service_resumed",
  "service_phase_started",
  "service_phase_completed",
  "service_item_completed",
  "service_item_overdue",
  "service_light_changed",
  "program_lesson_completed",
  "program_module_completed",
  "quiz_passed",
  "quiz_failed",
  "task_submission_received",
  "task_submission_reviewed",
  "live_session_missed",
  "challenge_started",
  "challenge_occurrence_due_soon",
  "challenge_occurrence_overdue",
  "challenge_completed",
  "certificate_issued",
  "portal_access_expiring",
  "portal_access_expired",
  // A4 (F158): los emite el barrido diario, uno por disparador, servicio y día (00372).
  "service_relative",
  "service_phase_periodic",
] as const;
export type ServiceTriggerType = (typeof SERVICE_TRIGGER_TYPES)[number];

export const SERVICE_TRIGGER_LABELS: Record<ServiceTriggerType, { label: string; description: string }> = {
  service_created: { label: "Se creó un servicio", description: "Cuando nace un servicio, solo al cobrar o a mano" },
  service_started: { label: "Empezó un servicio", description: "El día de la fecha de inicio del servicio" },
  service_ending_soon: { label: "Un servicio está por terminar", description: "N días antes de la fecha de fin" },
  service_status_changed: { label: "Cambió el estado de un servicio", description: "Activo, pausado, completado, cancelado o renovado" },
  service_extended: { label: "Se extendió un servicio", description: "Cuando se corre la fecha de fin" },
  service_paused: { label: "Se pausó un servicio", description: "Cuando se pausa" },
  service_resumed: { label: "Se reanudó un servicio", description: "Cuando se reanuda" },
  service_phase_started: { label: "Empezó una fase del camino", description: "Al abrirse una fase" },
  service_phase_completed: { label: "Terminó una fase del camino", description: "Al cerrarse una fase" },
  service_item_completed: { label: "Se completó un paso del camino", description: "Cuando un paso queda completo" },
  service_item_overdue: { label: "Se venció un paso del camino", description: "Cuando un paso pasa su fecha" },
  service_light_changed: { label: "Cambió el semáforo de un servicio", description: "Cuando cambia el color" },
  program_lesson_completed: { label: "Completó una clase", description: "Cuando un estudiante termina una clase del programa" },
  program_module_completed: { label: "Completó un módulo", description: "Cuando un estudiante termina un módulo" },
  quiz_passed: { label: "Aprobó una evaluación", description: "Cuando aprueba una evaluación automática" },
  quiz_failed: { label: "No aprobó una evaluación", description: "Cuando no llega a la nota" },
  task_submission_received: { label: "Entregó una actividad", description: "Cuando llega una entrega" },
  task_submission_reviewed: { label: "Se revisó una actividad", description: "Cuando el equipo la revisa o la califica" },
  live_session_missed: { label: "Faltó a una clase en vivo", description: "Al cerrarse la ventana de asistencia sin asistencia" },
  challenge_started: { label: "Empezó el Reto", description: "Cuando se abre la fase Reto" },
  challenge_occurrence_due_soon: { label: "Se acerca una entrega del Reto", description: "Antes de que venza una repetición" },
  challenge_occurrence_overdue: { label: "Se venció una entrega del Reto", description: "Cuando una repetición vence sin entregar" },
  challenge_completed: { label: "Terminó el Reto", description: "Cuando se cierra la fase Reto" },
  certificate_issued: { label: "Se emitió un certificado", description: "Cuando se genera el certificado del servicio" },
  portal_access_expiring: { label: "Un acceso al portal está por vencer", description: "Antes de que venza un acceso" },
  portal_access_expired: { label: "Venció un acceso al portal", description: "Cuando un acceso llega a su fin" },
  service_relative: { label: "Días antes o después de…", description: "Del inicio, el fin o la creación del servicio, de una fase o de completar un paso" },
  service_phase_periodic: { label: "Cada N días en una fase", description: "Mientras el servicio esté en esa fase (sin contar las pausas)" },
};

/** Los dos que emite el barrido para UN disparador: el evento lleva su `trigger_id` (A4, F158). */
export const PER_TRIGGER_SERVICE_TYPES = ["service_relative", "service_phase_periodic"] as const;

export interface ServiceTriggerConfig {
  product_id?: string | null;
  variant_id?: string | null;
  phase_key?: string | null;
  item_key?: string | null;
  /** Solo service_ending_soon: cuantos dias antes. */
  days_before?: number | null;
}

export interface ServiceEventPayload {
  service_id?: string;
  product_id?: string;
  variant_id?: string | null;
  phase_key?: string;
  item_key?: string;
  days_before?: number;
  [k: string]: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Si el evento pasa los filtros de la regla. Un filtro vacio deja pasar todo. Los relativos y periodicos (A4) ya
 * vienen hechos para UN disparador: pasan solo si el evento es de ese disparador (`trigger_id`).
 */
export function serviceEventMatches(config: unknown, payload: unknown, triggerId?: string | null): boolean {
  const c = (config ?? {}) as ServiceTriggerConfig;
  const p = (payload ?? {}) as ServiceEventPayload;
  if (typeof p.trigger_id === "string") return !!triggerId && p.trigger_id === triggerId;
  if (str(c.product_id) && c.product_id !== p.product_id) return false;
  if (str(c.variant_id) && c.variant_id !== p.variant_id) return false;
  if (str(c.phase_key) && c.phase_key !== p.phase_key) return false;
  if (str(c.item_key) && c.item_key !== p.item_key) return false;
  // «Termina en N días»: el editor guarda `days_before` y el barrido viejo emitía `days` (A4 lo arregla: manda los dos).
  const eventDays = typeof p.days_before === "number" ? p.days_before : typeof p.days === "number" ? p.days : null;
  if (typeof c.days_before === "number" && eventDays !== null && c.days_before !== eventDays) return false;
  return true;
}

/** Una corrida por evento y regla: la clave es el id del evento. */
export function serviceDedupeKey(type: string, eventId: string): string {
  return `${type}:${eventId}`;
}

/** Las variables que el flujo puede usar ({{service.*}}). */
export const SERVICE_VARIABLE_FIELDS = [
  { path: "service.id", label: "Id del servicio" },
  { path: "service.status", label: "Estado del servicio" },
  { path: "service.product", label: "Producto" },
  { path: "service.variant", label: "Variante" },
  { path: "service.start_on", label: "Fecha de inicio" },
  { path: "service.end_on", label: "Fecha de fin" },
  { path: "service.light", label: "Semáforo" },
  { path: "service.phase", label: "Fase en curso" },
] as const;

export interface ServiceForVariables {
  id: string;
  status: string;
  product_snapshot: { product_name?: string; variant_name?: string } | null;
  starts_on: string | null;
  ends_on: string | null;
  light: string | null;
  phase_name?: string | null;
}

export function serviceVariables(s: ServiceForVariables | null): Record<string, string> {
  if (!s) return {};
  return {
    "service.id": s.id,
    "service.status": s.status,
    "service.product": s.product_snapshot?.product_name ?? "",
    "service.variant": s.product_snapshot?.variant_name ?? "",
    "service.start_on": s.starts_on ?? "",
    "service.end_on": s.ends_on ?? "",
    "service.light": s.light ?? "",
    "service.phase": s.phase_name ?? "",
  };
}

/**
 * Lo que un flujo de servicio recibe de verdad: las claves planas de siempre MAS el mismo dato anidado
 * (`service: { id, variant… }`) y la venta del servicio (`sale: { id }`).
 *
 * Por que anidado: el interpolador y el firmador de `{{form_link.*}}` siguen el camino `service` → `id`
 * adentro de un objeto; una clave plana `"service.id"` no la lee ninguno de los dos. Sin `sale.id`, el link
 * firmado de un contrato sale sin la venta y `{{venta.variante}}` / `{{venta.monto}}` quedan en «—».
 * Las claves planas se conservan para no cambiar nada de lo que ya las lea.
 */
export function serviceFlowVariables(s: ServiceForVariables | null, saleId: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  const flat = serviceVariables(s);
  const nested: Record<string, string> = {};
  for (const [path, value] of Object.entries(flat)) nested[path.slice("service.".length)] = value;
  return {
    ...flat,
    service: nested,
    ...(typeof saleId === "string" && saleId ? { sale: { id: saleId } } : {}),
  };
}
