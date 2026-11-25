// @plantilla-quitar(servicios)
/**
 * El estado de una vuelta de Reunión que se repite (00524) en la ficha del servicio. PURO.
 *
 *   to_schedule → por agendar · scheduled → agendada · attended → asistió · no_show → no se presentó · lost → perdida
 *
 * Una vuelta se cumple SOLO al asistir. «No se presentó» no cuenta: se reagenda o se da por perdida. «Perdida» la cierra
 * sin contar para «N vueltas».
 */
export type RoundState = "to_schedule" | "scheduled" | "attended" | "no_show" | "lost";
export type RoundAction = "attended" | "no_show" | "lost";

export const ROUND_STATE_LABEL: Record<RoundState, string> = {
  to_schedule: "Por agendar",
  scheduled: "Agendada",
  attended: "Asistió",
  no_show: "No se presentó",
  lost: "Perdida",
};

export const ROUND_ACTION_LABEL: Record<RoundAction, string> = {
  attended: "Asistió",
  no_show: "No se presentó",
  lost: "Dar por perdida",
};

export function readRoundState(v: unknown): RoundState | null {
  return typeof v === "string" && v in ROUND_STATE_LABEL ? (v as RoundState) : null;
}

/** Qué se puede marcar en una vuelta abierta. Una cerrada (asistió o perdida) no se marca más. */
export function roundActions(state: RoundState | null, pending: boolean): RoundAction[] {
  if (!state || !pending || state === "attended" || state === "lost") return [];
  if (state === "scheduled") return ["attended", "no_show"];
  if (state === "no_show") return ["attended", "lost"];
  return ["attended", "lost"];
}
