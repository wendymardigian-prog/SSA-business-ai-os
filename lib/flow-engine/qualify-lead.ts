/**
 * El paso «Calificar lead» (00329): lo que guarda, cómo se valida y qué decide.
 * PURO: lo importan el nodo del motor, el editor de pasos, el panel del lienzo y
 * el simulador (corre en el navegador).
 *
 * Cuatro modos:
 *  - `set`: fija el nivel (1-5).
 *  - `add`: suma o resta puntos (de -4 a +4), recortando entre 1 y 5.
 *  - `rules`: varias reglas, cada una con sus condiciones y sus puntos. Se miran
 *    TODAS (no la primera, como en «Condiciones») y se suman los puntos de las que
 *    se cumplen. Se parte del nivel actual o de un nivel fijo, y se aplica UN solo
 *    cambio.
 *  - `clear`: lo quita («Sin calificar»).
 */
import type { BranchCondition, ConditionGroup } from "./condition-eval";
import { nextQualificationLevel, type QualificationLevel, type QualificationMode } from "@/lib/contacts/qualification";

export const QUALIFY_LEAD_TYPE = "qualify_lead";

export const QUALIFY_MODES = ["set", "add", "rules", "clear"] as const;
export type QualifyStepMode = (typeof QUALIFY_MODES)[number];

export const QUALIFY_MODE_LABELS: Record<QualifyStepMode, string> = {
  set: "Fijar un nivel",
  add: "Sumar o restar puntos",
  rules: "Según reglas",
  clear: "Quitar la calificación",
};

export const POINTS_MIN = -4;
export const POINTS_MAX = 4;
export const MAX_RULES = 15;
export const RULE_LABEL_MAX = 60;

export interface QualificationRule extends ConditionGroup {
  /** No cambia nunca (la clave de React y del historial). */
  id: string;
  /** Un nombre corto opcional («Presupuesto alto»). */
  label?: string;
  /** Lo que suma (o resta) si se cumple. */
  points: number;
}

export interface QualifyLeadStepData {
  actionType: typeof QUALIFY_LEAD_TYPE;
  mode: QualifyStepMode;
  /** `set`: el nivel. */
  level?: number;
  /** `add`: los puntos. */
  points?: number;
  /** `rules`: desde dónde se suma. */
  base?: "current" | number;
  rules?: QualificationRule[];
  label?: string;
}

export function blankQualifyStep(): QualifyLeadStepData {
  return { actionType: QUALIFY_LEAD_TYPE, mode: "add", points: 1 };
}

export function newRuleId(taken: Iterable<string> = [], random: () => number = Math.random): string {
  const used = new Set(taken);
  for (let i = 0; i < 50; i++) {
    const id = `r_${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;
    if (!used.has(id)) return id;
  }
  return `r_${Date.now().toString(36)}`;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isLevel = (v: unknown): v is number => isInt(v) && v >= 1 && v <= 5;
const isPoints = (v: unknown): v is number => isInt(v) && v >= POINTS_MIN && v <= POINTS_MAX;

function rulesOf(data: Partial<QualifyLeadStepData>): QualificationRule[] {
  return Array.isArray(data.rules) ? data.rules : [];
}

/** Todas las condiciones de las reglas (las que hay que resolver antes de evaluar). */
export function ruleConditions(data: Partial<QualifyLeadStepData>): BranchCondition[] {
  return rulesOf(data).flatMap((r) => (Array.isArray(r.conditions) ? r.conditions : []));
}

/** ¿Está bien armado el paso? `null` si sí, o el motivo en palabras. */
export function checkQualifyStep(data: Partial<QualifyLeadStepData> | null | undefined): string | null {
  if (!data || !QUALIFY_MODES.includes(data.mode as QualifyStepMode)) return "Elegí qué hacer con la calificación.";
  switch (data.mode) {
    case "set":
      return isLevel(data.level) ? null : "Elegí un nivel del 1 al 5.";
    case "add":
      return isPoints(data.points) && data.points !== 0 ? null : `Elegí cuántos puntos sumar o restar (de ${POINTS_MIN} a +${POINTS_MAX}).`;
    case "clear":
      return null;
    case "rules": {
      const rules = rulesOf(data);
      if (rules.length === 0) return "Sumá al menos una regla.";
      if (rules.length > MAX_RULES) return `Hasta ${MAX_RULES} reglas.`;
      if (!(data.base === "current" || isLevel(data.base))) return "Elegí desde dónde se cuenta.";
      for (const [i, rule] of rules.entries()) {
        if (!isPoints(rule.points) || rule.points === 0) return `Regla ${i + 1}: elegí cuántos puntos suma o resta.`;
        if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) return `Regla ${i + 1}: sumá al menos una condición.`;
        if (rule.label && rule.label.length > RULE_LABEL_MAX) return `Regla ${i + 1}: el nombre es muy largo.`;
      }
      return null;
    }
  }
  return "Elegí qué hacer con la calificación.";
}

export type QualifyOutcome =
  | { kind: "apply"; mode: QualificationMode; value: number | null; target: QualificationLevel | null; points: number }
  | { kind: "none"; reason: string };

/**
 * Qué cambio pide el paso, dado el nivel actual y (en `rules`) los puntos de las
 * reglas que se cumplieron. La base vuelve a recortar al aplicar
 * (`set_contact_qualification`); esto sirve para decidir y para el simulador.
 */
export function qualifyOutcome(
  data: Partial<QualifyLeadStepData>,
  current: number | null,
  matchedPoints: readonly number[] = [],
): QualifyOutcome {
  const invalid = checkQualifyStep(data);
  if (invalid) return { kind: "none", reason: invalid };
  const sum = matchedPoints.reduce((a, b) => a + b, 0);
  const target = (mode: QualificationMode, value: number | null): QualifyOutcome => {
    const next = nextQualificationLevel(current, mode, value);
    if (next === "invalid") return { kind: "none", reason: "El nivel no es válido." };
    return { kind: "apply", mode, value, target: next, points: mode === "add" ? (value ?? 0) : sum };
  };
  switch (data.mode) {
    case "set":
      return target("set", data.level as number);
    case "add":
      return target("add", data.points as number);
    case "clear":
      return target("clear", null);
    case "rules": {
      if (matchedPoints.length === 0) return { kind: "none", reason: "No se cumplió ninguna regla." };
      if (data.base === "current") {
        if (sum === 0) return { kind: "none", reason: "Las reglas que se cumplieron suman 0." };
        return target("add", sum);
      }
      const level = Math.max(1, Math.min(5, (data.base as number) + sum)) as QualificationLevel;
      return { kind: "apply", mode: "set", value: level, target: level, points: sum };
    }
  }
  return { kind: "none", reason: "Elegí qué hacer con la calificación." };
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** El paso en palabras (la tarjeta del editor y el lienzo). */
export function describeQualifyStep(data: Partial<QualifyLeadStepData> | null | undefined): string {
  if (!data) return "Calificar lead";
  switch (data.mode) {
    case "set":
      return isLevel(data.level) ? `Calificar lead: nivel ${data.level}` : "Calificar lead";
    case "add":
      return isPoints(data.points) && data.points !== 0 ? `Calificar lead: ${signed(data.points)} ${Math.abs(data.points) === 1 ? "punto" : "puntos"}` : "Calificar lead";
    case "clear":
      return "Quitar la calificación";
    case "rules": {
      const n = rulesOf(data).length;
      const from = data.base === "current" ? "desde el nivel actual" : isLevel(data.base) ? `desde el nivel ${data.base}` : "";
      return `Calificar lead según ${n} ${n === 1 ? "regla" : "reglas"}${from ? ` (${from})` : ""}`;
    }
  }
  return "Calificar lead";
}

/** Lo que queda en el historial del paso: qué reglas se cumplieron (solo el nombre y los puntos, nunca los valores). */
export function rulesReason(rules: readonly QualificationRule[], matched: ReadonlySet<string>): string {
  const hit = rules.filter((r) => matched.has(r.id));
  if (hit.length === 0) return "Ninguna regla se cumplió";
  return hit.map((r, i) => `${r.label?.trim() || `Regla ${rules.indexOf(r) + 1 || i + 1}`} (${signed(r.points)})`).join(", ");
}

// ---------------------------------------------------------------------------
// El disparador «Cambió la calificación» (evento `qualification_changed`, dentro de «Evento del CRM»)
// ---------------------------------------------------------------------------

export const QUALIFICATION_CHANGED_EVENT = "qualification_changed";

/**
 * Qué cambio de calificación dispara el flujo (`config.value`):
 *  - "" : cualquiera.
 *  - "up" / "down": cuando sube / cuando baja (quitarla cuenta como bajar).
 *  - "eq:N": cuando queda exactamente en N.
 *  - "gte:N": cuando llega a N o más viniendo de menos (o de sin calificar). Subir de 4 a 5 con N = 4 no vuelve a disparar.
 *  - "lt:N": cuando baja de N viniendo de N o más.
 */
export type QualificationTriggerKind = "any" | "up" | "down" | "eq" | "gte" | "lt";

export function parseQualificationTrigger(value: unknown): { kind: QualificationTriggerKind; level: number | null } {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "") return { kind: "any", level: null };
  if (raw === "up" || raw === "down") return { kind: raw, level: null };
  const m = /^(eq|gte|lt):([1-5])$/.exec(raw);
  if (m) return { kind: m[1] as "eq" | "gte" | "lt", level: Number(m[2]) };
  return { kind: "any", level: null };
}

const levelOf = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

/** ¿Este cambio (el payload del evento) cumple lo que pide el disparador? Puro. */
export function qualificationEventMatches(value: unknown, payload: Record<string, unknown>): boolean {
  const { kind, level } = parseQualificationTrigger(value);
  const now = levelOf(payload.level);
  const before = levelOf(payload.previous_level);
  const rank = (v: number | null) => v ?? 0;
  switch (kind) {
    case "any":
      return true;
    case "up":
      return rank(now) > rank(before);
    case "down":
      return rank(now) < rank(before);
    case "eq":
      return now === level;
    case "gte":
      return level !== null && rank(now) >= level && rank(before) < level;
    case "lt":
      return level !== null && rank(now) < level && rank(before) >= level;
  }
}

/** El disparador en palabras («cuando llega a 4 o más»). */
export function describeQualificationTrigger(value: unknown): string {
  const { kind, level } = parseQualificationTrigger(value);
  switch (kind) {
    case "any":
      return "cualquier cambio";
    case "up":
      return "cuando sube";
    case "down":
      return "cuando baja";
    case "eq":
      return `cuando queda en ${level}`;
    case "gte":
      return `cuando llega a ${level} o más`;
    case "lt":
      return `cuando baja de ${level}`;
  }
}
