import { normalizeForGrouping } from "@/lib/text/normalize";
import { fieldDef, isPreField, type RuleAction, type RuleOperator, type RuleStage } from "./fields";
// nota: matchCondition sigue devolviendo null para inválidos, pero el loop ya
// filtró la invalidez estructural; acá null se trata como no-coincide.

export interface RuleCondition {
  field: string;
  op: RuleOperator | string;
  value: unknown;
}

export interface Rule {
  id: string;
  name?: string | null;
  enabled: boolean;
  conditions: RuleCondition[];
  action: RuleAction;
}

/** Contexto del turno para evaluar reglas. Los campos `final` faltan antes de generar. */
export interface RuleContext {
  inbound: { text: string; is_known_button: boolean; length: number; burst_count: number };
  contact: { temperature: string | null; tags: string[]; is_new: boolean; previous_episodes: number };
  conversation: { assigned: boolean; window_hours_left: number | null; is_episode_start: boolean; channel: string };
  time: { in_business_hours: boolean };
  response?: { text: string; has_link: boolean; parts: number };
  agent?: { wants_escalate: boolean; kb_miss: boolean; used_tools: string[] };
  intent?: { category_id: string | null; confidence: number } | null;
}

export interface RuleEvalResult {
  /** La acción de la regla que coincidió, la default, o `pending` (falta generar). */
  action: RuleAction | "pending";
  ruleId: string | null;
  ruleIndex: number | null;
  matched: boolean;
  /** Reglas salteadas por campo/operador inválido (no rompen el turno). */
  invalidRules: string[];
}

const norm = (s: unknown): string => normalizeForGrouping(typeof s === "string" ? s : "");
const asWords = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);
const asNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Lee el valor del contexto para un campo de la lista cerrada. undefined = falta. */
function readField(ctx: RuleContext, field: string): unknown {
  switch (field) {
    case "inbound.text": return ctx.inbound.text;
    case "inbound.is_known_button": return ctx.inbound.is_known_button;
    case "inbound.length": return ctx.inbound.length;
    case "inbound.burst_count": return ctx.inbound.burst_count;
    case "contact.temperature": return ctx.contact.temperature;
    case "contact.tags": return ctx.contact.tags;
    case "contact.is_new": return ctx.contact.is_new;
    case "contact.previous_episodes": return ctx.contact.previous_episodes;
    case "conversation.assigned": return ctx.conversation.assigned;
    case "conversation.window_hours_left": return ctx.conversation.window_hours_left;
    case "conversation.is_episode_start": return ctx.conversation.is_episode_start;
    case "conversation.channel": return ctx.conversation.channel;
    case "time.in_business_hours": return ctx.time.in_business_hours;
    case "response.text": return ctx.response?.text;
    case "response.has_link": return ctx.response?.has_link;
    case "response.parts": return ctx.response?.parts;
    case "agent.wants_escalate": return ctx.agent?.wants_escalate;
    case "agent.kb_miss": return ctx.agent?.kb_miss;
    case "agent.used_tool": return ctx.agent?.used_tools;
    case "intent.category": return ctx.intent ?? undefined;
    default: return undefined;
  }
}

/** Evalúa una condición. null = no se puede (campo/op inválido). */
function matchCondition(ctx: RuleContext, cond: RuleCondition): boolean | null {
  const def = fieldDef(cond.field);
  if (!def) return null;
  if (!def.operators.includes(cond.op as RuleOperator)) return null;

  const actual = readField(ctx, cond.field);
  if (actual === undefined) return null; // el campo final todavía no está

  switch (cond.op) {
    case "contains_any": {
      const text = norm(actual);
      return asWords(cond.value).some((w) => text.includes(norm(w)) && norm(w) !== "");
    }
    case "not_contains_any": {
      const text = norm(actual);
      return !asWords(cond.value).some((w) => text.includes(norm(w)) && norm(w) !== "");
    }
    case "is": {
      // intent es especial: value = { category_id, min_confidence? }
      if (cond.field === "intent.category") return intentIs(actual, cond.value);
      if (cond.field === "agent.used_tool") return asWords(actual).includes(String(cond.value));
      return actual === cond.value;
    }
    case "is_not": {
      if (cond.field === "intent.category") return !intentIs(actual, cond.value);
      return actual !== cond.value;
    }
    case "gt": {
      const n = asNumber(actual);
      const t = asNumber(cond.value);
      return n !== null && t !== null ? n > t : false;
    }
    case "lt": {
      const n = asNumber(actual);
      const t = asNumber(cond.value);
      return n !== null && t !== null ? n < t : false;
    }
    case "has_any": {
      const tags = asWords(actual).map(norm);
      return asWords(cond.value).some((v) => tags.includes(norm(v)));
    }
    case "has_none": {
      const tags = asWords(actual).map(norm);
      return !asWords(cond.value).some((v) => tags.includes(norm(v)));
    }
    default:
      return null;
  }
}

function intentIs(actual: unknown, value: unknown): boolean {
  const intent = actual as { category_id: string | null; confidence: number } | null | undefined;
  if (!intent || !intent.category_id) return false;
  const v = (value ?? {}) as { category_id?: string; min_confidence?: number };
  if (v.category_id && intent.category_id !== v.category_id) return false;
  if (typeof v.min_confidence === "number" && intent.confidence < v.min_confidence) return false;
  return Boolean(v.category_id);
}

/**
 * Evalúa la lista de reglas (F8). Gana la primera que coincide; si ninguna, la
 * default. En `before_generation` corta en la primera regla que mira campos de
 * la respuesta (devuelve `pending`); en `after_generation` evalúa todo.
 *
 * Propiedad clave: evaluar en dos etapas da el mismo resultado que evaluar la
 * lista completa con el contexto completo.
 */
export function evaluateRules(
  rules: Rule[],
  context: RuleContext,
  stage: RuleStage,
  defaultAction: RuleAction,
): RuleEvalResult {
  const invalidRules: string[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule.enabled) continue;

    // Validez estructural: campo de la lista cerrada y operador que ese campo
    // acepta. Una regla estructuralmente inválida se saltea y se reporta, sin
    // importar la etapa (un campo desconocido no es "de la etapa final").
    const structurallyInvalid =
      rule.conditions.length === 0 ||
      rule.conditions.some((c) => {
        const def = fieldDef(c.field);
        return !def || !def.operators.includes(c.op as never);
      });
    if (structurallyInvalid) {
      invalidRules.push(rule.id);
      continue;
    }

    const touchesFinal = rule.conditions.some((c) => !isPreField(c.field));
    if (stage === "before_generation" && touchesFinal) {
      // No se puede decidir sin la respuesta: cortar acá.
      return { action: "pending", ruleId: null, ruleIndex: null, matched: false, invalidRules };
    }

    // ¿Coinciden TODAS las condiciones? Un valor que todavía no está (campo
    // final antes de generar) cuenta como no-coincide.
    const allMatch = rule.conditions.every((cond) => matchCondition(context, cond) === true);
    if (allMatch) {
      return { action: rule.action, ruleId: rule.id, ruleIndex: i, matched: true, invalidRules };
    }
  }

  return { action: defaultAction, ruleId: null, ruleIndex: null, matched: false, invalidRules };
}
