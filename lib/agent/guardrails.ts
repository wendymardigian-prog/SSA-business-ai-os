import { zonedClock, BUSINESS_TIMEZONE } from "@/lib/dates";
import type { Guardrails } from "./schemas";
import { findPhrase } from "./text";

/**
 * Guardarrailes que se evaluan ANTES de llamar al modelo (F25).
 *
 * Antes y no despues por dos razones: es mas barato (no se gasta un token) y
 * es mas seguro (una palabra vedada no viaja al proveedor). El tope de gasto
 * tambien va antes de la llamada, pero necesita la base: vive en
 * lib/ai/spend.ts.
 *
 * Funcion pura: recibe los conteos ya calculados y decide. Cada bloqueo dice
 * que hacer y por que, para que el run lo deje escrito.
 */

export type GuardrailBlock =
  | { kind: "blocked_topic"; action: "escalate"; detail: string }
  | { kind: "frustration"; action: "escalate"; detail: string }
  | { kind: "urgency"; action: "escalate"; detail: string }
  | { kind: "reply_cap"; action: "escalate"; detail: string }
  | { kind: "unresolved_turns"; action: "escalate"; detail: string }
  | { kind: "outside_hours"; action: "silent" | "notice"; detail: string };

export interface GuardrailInput {
  guardrails: Guardrails;
  /** Todos los mensajes de la rafaga, juntos. */
  burstText: string;
  now: Date;
  /** Respuestas del agente desde la ultima intervencion de una persona del equipo. */
  repliesSinceHuman: number;
  maxRepliesPerConversation: number;
  /** Turnos seguidos del agente en el intercambio actual. */
  unresolvedTurns: number;
  timeZone?: string;
}

export function isWithinBusinessHours(
  guardrails: Guardrails,
  now: Date,
  timeZone: string = BUSINESS_TIMEZONE,
): boolean {
  const hours = guardrails.businessHours;
  if (!hours.enabled) return true;
  const { weekday, minutes } = zonedClock(now, timeZone);
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return hours.slots.some(
    (slot) => slot.day === weekday && minutes >= toMinutes(slot.start) && minutes < toMinutes(slot.end),
  );
}

/**
 * El orden importa: lo que deriva por el CONTENIDO del mensaje va primero,
 * porque aunque este fuera de horario, un reclamo o un "quiero hablar con una
 * persona" tiene que llegarle a alguien.
 */
export function evaluateGuardrails(input: GuardrailInput): GuardrailBlock | null {
  const g = input.guardrails;

  if (g.blockedTopics.enabled) {
    const hit = findPhrase(input.burstText, g.blockedTopics.phrases);
    if (hit) return { kind: "blocked_topic", action: "escalate", detail: `tema vedado: ${hit}` };
  }
  if (g.escalation.frustration) {
    const hit = findPhrase(input.burstText, g.escalation.frustrationPhrases);
    if (hit) return { kind: "frustration", action: "escalate", detail: `enojo detectado: ${hit}` };
  }
  if (g.escalation.urgency) {
    const hit = findPhrase(input.burstText, g.escalation.urgencyPhrases);
    if (hit) return { kind: "urgency", action: "escalate", detail: `urgencia detectada: ${hit}` };
  }

  if (!isWithinBusinessHours(g, input.now, input.timeZone)) {
    return { kind: "outside_hours", action: g.businessHours.outsideMode, detail: "fuera del horario de atencion" };
  }

  if (input.repliesSinceHuman >= input.maxRepliesPerConversation) {
    return {
      kind: "reply_cap",
      action: "escalate",
      detail: `tope de ${input.maxRepliesPerConversation} respuestas sin intervencion humana`,
    };
  }
  if (input.unresolvedTurns >= g.escalation.maxUnresolvedTurns) {
    return {
      kind: "unresolved_turns",
      action: "escalate",
      detail: `${input.unresolvedTurns} turnos seguidos sin resolver`,
    };
  }

  return null;
}
