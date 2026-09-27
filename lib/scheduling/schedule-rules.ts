/**
 * Reglas de los horarios que no dependen de la base (F10, F14): que se puede
 * borrar, como se llama una copia, que pasa con los eventos al borrar, y el
 * switch "Eventos con este horario".
 */

export interface ScheduleSummaryRow {
  id: string;
  name: string;
  is_default: boolean;
}

export type DeleteScheduleDecision =
  | { ok: true; moveEventsTo: string | null }
  | { ok: false; reason: "is_default" | "needs_replacement" | "replacement_invalid"; message: string };

/**
 * Borrar un horario: el por defecto nunca; si lo usan eventos, hace falta
 * decir a cual pasan (y tiene que ser otro horario vivo de la misma persona).
 */
export function decideDeleteSchedule(input: {
  schedule: ScheduleSummaryRow;
  others: ScheduleSummaryRow[];
  eventsUsingIt: number;
  replacementId?: string | null;
}): DeleteScheduleDecision {
  if (input.schedule.is_default) {
    return { ok: false, reason: "is_default", message: "El horario por defecto no se puede borrar. Marcá otro por defecto primero." };
  }
  if (input.eventsUsingIt === 0) return { ok: true, moveEventsTo: null };
  if (!input.replacementId) {
    return {
      ok: false,
      reason: "needs_replacement",
      message: `${input.eventsUsingIt === 1 ? "1 evento usa" : `${input.eventsUsingIt} eventos usan`} este horario. Elegí a qué horario pasan antes de borrarlo.`,
    };
  }
  const replacement = input.others.find((s) => s.id === input.replacementId);
  if (!replacement || replacement.id === input.schedule.id) {
    return { ok: false, reason: "replacement_invalid", message: "El horario de reemplazo tiene que ser otro de tus horarios." };
  }
  return { ok: true, moveEventsTo: replacement.id };
}

/** "Horario normal" → "Horario normal (copia)", "(copia 2)", … */
export function copyName(name: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const base = name.replace(/\s\(copia(?: \d+)?\)$/i, "").slice(0, 50);
  let candidate = `${base} (copia)`;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base} (copia ${i})`;
  return candidate;
}

export interface EventScheduleRow {
  id: string;
  title: string;
  /** null = usa el horario por defecto de la persona. */
  schedule_id: string | null;
}

/**
 * F14: que eventos aparecen encendidos en la tarjeta de un horario. Los que
 * usan el por defecto implicitamente (schedule_id null) se ven encendidos en
 * ese horario, con la etiqueta "por defecto".
 */
export function eventsForSchedule(
  events: EventScheduleRow[],
  schedule: { id: string; is_default: boolean },
): Array<EventScheduleRow & { on: boolean; implicitDefault: boolean }> {
  return events.map((e) => {
    const implicitDefault = e.schedule_id === null && schedule.is_default;
    return { ...e, on: e.schedule_id === schedule.id || implicitDefault, implicitDefault };
  });
}

export type ToggleEventScheduleDecision =
  | { change: true; scheduleId: string | null }
  | { change: false; reason: "already_default"; tooltip: string };

/**
 * Encender un evento en un horario lo asigna; apagarlo lo devuelve al por
 * defecto (`null`). Apagar un evento que ya usa el por defecto implicitamente
 * en el horario por defecto no cambia nada: se explica con un tooltip.
 */
export function decideToggleEventSchedule(input: {
  event: EventScheduleRow;
  schedule: { id: string; is_default: boolean };
  turnOn: boolean;
}): ToggleEventScheduleDecision {
  if (input.turnOn) return { change: true, scheduleId: input.schedule.id };
  if (input.schedule.is_default && input.event.schedule_id === null) {
    return { change: false, reason: "already_default", tooltip: "Este evento ya usa tu horario por defecto. Para cambiarlo, encendelo en otro horario." };
  }
  return { change: true, scheduleId: null };
}
