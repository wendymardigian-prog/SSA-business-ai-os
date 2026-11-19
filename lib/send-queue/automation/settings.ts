/**
 * Lo que guarda cada automatización y cada paso de WhatsApp sobre la cola. PURO.
 *
 * En la AUTOMATIZACIÓN (los datos del disparador, `data.whatsappQueue`; así respetan borrador y publicación como todo el
 * resto del grafo): la prioridad, la caducidad y el límite por hora de la automatización.
 *
 * En cada PASO de WhatsApp (`data.delivery`): cómo sale (`auto`, `queue` o `immediate`) y la programación.
 *
 * `auto` (lo de un paso viejo, sin la clave) decide por el DISPARADOR (decisión de Wendy del 18/11/2026):
 *   - si la automatización arranca porque el contacto escribió (palabra clave, botón, respuesta rápida, primer mensaje,
 *     cualquier mensaje, comentario) o por su agenda (confirmación, recordatorio, reprogramación…), sale AL INSTANTE,
 *     como siempre: quien escribió espera la respuesta ya, y un recordatorio no puede esperar al horario;
 *   - si arranca por cualquier otra cosa (etiqueta, alta de contacto, formulario, fecha, webhook, ventas, servicios),
 *     va POR LA COLA del número: ahí está el riesgo de bloqueo (una etiqueta puesta a 300 contactos dispara 300 mensajes);
 *   - un paso que manda a un GRUPO sale al instante: es un solo mensaje y suele tener hora fija (ver `resolveDeliveryMode`).
 */
import type { SendQueuePriority } from "@/lib/types/database";
import { BOOKING_TRIGGER_TYPES } from "@/lib/scheduling/automation/triggers";
import { parseExpiry, type ExpiryOption } from "./expiry";
import { parsePerRunLimit } from "./per-run";
import { parseSchedule, scheduleProblem, type ScheduleConfig } from "./schedule";

export interface QueueSettings {
  priority: SendQueuePriority;
  expiry: ExpiryOption;
  perRunLimit: number | null;
}

export const DEFAULT_QUEUE_SETTINGS: QueueSettings = { priority: "normal", expiry: "none", perRunLimit: null };

export const PRIORITY_LABELS: Record<SendQueuePriority, string> = { urgent: "Urgente", normal: "Normal", bulk: "Masivo" };

export const PRIORITY_HELP: Record<SendQueuePriority, string> = {
  urgent: "Va delante de lo normal y lo masivo y puede usar la reserva del 20 % del cupo por hora del número.",
  normal: "Espera su turno en la cola del número, dentro de su horario de envío.",
  bulk: "Solo sale cuando no queda nada urgente ni normal esperando. Se puede pausar entero desde la cola.",
};

/**
 * Los disparadores que hacen salir al instante un paso en `auto`: los de un mensaje o un comentario del contacto
 * (`scope` «message» o «comment» en el registro) y los de su agenda (`sourceType` «booking»).
 * `instant-triggers.test.ts` controla que la lista siga al registro.
 */
export const MESSAGE_TRIGGER_TYPES = ["postback", "quick_reply", "keyword", "welcome", "default", "comment_keyword"] as const;
export const INSTANT_TRIGGER_TYPES: readonly string[] = [...MESSAGE_TRIGGER_TYPES, ...BOOKING_TRIGGER_TYPES];

export function isInstantTrigger(triggerType: unknown): boolean {
  return typeof triggerType === "string" && INSTANT_TRIGGER_TYPES.includes(triggerType);
}

/** Lo guardado en el disparador (`data.whatsappQueue`), leído sin lanzar. */
export function parseQueueSettings(raw: unknown): QueueSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_QUEUE_SETTINGS;
  const r = raw as Record<string, unknown>;
  const priority: SendQueuePriority = r.priority === "urgent" || r.priority === "normal" || r.priority === "bulk" ? r.priority : DEFAULT_QUEUE_SETTINGS.priority;
  return {
    priority,
    expiry: r.expiry === undefined ? DEFAULT_QUEUE_SETTINGS.expiry : parseExpiry(r.expiry),
    perRunLimit: r.perRunLimit === undefined ? DEFAULT_QUEUE_SETTINGS.perRunLimit : parsePerRunLimit(r.perRunLimit),
  };
}

export type DeliveryMode = "auto" | "queue" | "immediate";

export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  auto: "Según el disparador",
  queue: "Por la cola del número",
  immediate: "Al instante",
};

export interface DeliveryConfig {
  mode: DeliveryMode;
  schedule: ScheduleConfig;
}

/** Lo guardado en un paso de WhatsApp (`data.delivery`), leído sin lanzar. */
export function parseDelivery(raw: unknown): DeliveryConfig {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode: DeliveryMode = r.mode === "queue" || r.mode === "immediate" ? r.mode : "auto";
  return { mode, schedule: parseSchedule(r.schedule) };
}

/**
 * ¿Este paso sale al instante o por la cola? `triggerType`: el disparador PUBLICADO de la automatización. `groupStep`: el
 * paso manda a un GRUPO («Enviar al grupo», «Enviar encuesta»): es un solo mensaje, sin ráfaga posible, y suele ir con
 * hora («Recordatorios 7 AM»): en `auto` sale al instante para no correrse a la apertura del horario del número.
 */
export function resolveDeliveryMode(delivery: DeliveryConfig, triggerType: unknown, opts: { groupStep?: boolean } = {}): "queue" | "immediate" {
  if (delivery.mode === "queue" || delivery.mode === "immediate") return delivery.mode;
  // Un paso programado va siempre por la cola (la programación es de la cola).
  if (delivery.schedule.enabled) return "queue";
  if (opts.groupStep) return "immediate";
  return isInstantTrigger(triggerType) ? "immediate" : "queue";
}

/** Qué está mal en la entrega de un paso de WhatsApp (para no publicar), o null. */
export function deliveryProblem(raw: unknown): string | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const s = scheduleProblem(r.schedule);
  if (s) return s;
  const d = parseDelivery(raw);
  if (d.mode === "immediate" && d.schedule.enabled) return "Un WhatsApp «al instante» no se puede programar: sacá la programación o mandalo por la cola.";
  return null;
}
