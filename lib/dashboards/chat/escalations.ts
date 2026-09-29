/**
 * "Por qué derivó" y "Resultados de reglas": dos listas que vienen con claves
 * tecnicas y se muestran como oraciones.
 *
 * La regla de la UI: **`rule:r_3` nunca aparece en pantalla** (§16). Una decision
 * del agente se lee como una frase o no se muestra.
 */

import { describeRunDetail } from "@/lib/agent/run-labels";

/** Una fila de `chat_dashboard_escalation_reasons`. */
export interface EscalationSqlRow {
  reason_key: string;
  reason_label: string;
  origin: string | null;
  escalations: number;
  pct: number | null;
  is_other: boolean;
}

export interface EscalationReason {
  key: string;
  label: string;
  count: number;
  pct: number | null;
  isOther: boolean;
}

/** De donde salio la derivacion, en palabras. */
const ORIGIN_LABELS: Record<string, string> = {
  tool: "lo pidió el agente",
  guardrail: "lo frenó un guardarraíl",
  provider_failure: "falló el modelo",
  draft_approval: "al aprobar un borrador",
};

/**
 * Traduce el motivo de una derivacion.
 *
 * Los de guardarrail y de fallo del modelo llegan con una clave estable
 * (`guardrail:blocked_topic`, `spend:workspace`) y se traducen con el mismo
 * diccionario que la pantalla de Runs. Los de herramienta son texto libre del
 * modelo: se muestra tal cual lo escribio, con la primera en mayuscula.
 */
export function escalationReasons(rows: EscalationSqlRow[]): EscalationReason[] {
  return rows.map((r) => ({
    key: r.reason_key,
    label: escalationLabel(r),
    count: Number(r.escalations ?? 0),
    pct: r.pct === null || r.pct === undefined ? null : Number(r.pct),
    isOther: Boolean(r.is_other),
  }));
}

function escalationLabel(r: EscalationSqlRow): string {
  if (r.is_other) return "Otros motivos";
  if (r.reason_key === "sin_motivo") return "Sin motivo anotado";

  // Una clave tecnica (guardarrail, gasto, salida) tiene traduccion propia.
  const translated = describeRunDetail(r.reason_key);
  if (translated.length > 0 && translated[0] !== r.reason_key) {
    return capitalize(translated.join("; "));
  }

  const raw = (r.reason_label ?? "").trim();
  const base = raw.length > 0 ? raw : r.reason_key;
  const origin = r.origin && r.origin !== "tool" ? ORIGIN_LABELS[r.origin] : null;
  return origin ? `${capitalize(base)} (${origin})` : capitalize(base);
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** Una fila de `chat_dashboard_rule_results`. */
export interface RuleResultSqlRow {
  rule_id: string | null;
  rule_index: number | null;
  action: string;
  runs: number;
  degraded_to_draft: number;
  is_default: boolean;
}

export interface RuleResultRow {
  key: string;
  /** "Regla 3 · menciona precio" o "Acción por defecto". Nunca el id. */
  label: string;
  action: string;
  actionLabel: string;
  runs: number;
  degradedToDraft: number;
  isDefault: boolean;
}

const ACTION_LABELS: Record<string, string> = {
  send: "se enviaron directo",
  draft: "quedaron en borrador",
  skip: "no se respondieron",
};

/**
 * Arma las filas con el nombre de cada regla.
 *
 * `rules` sale de `agents.response_rules`. Una regla borrada despues de correr
 * sigue teniendo turnos: se muestra por su numero, no desaparece.
 */
export function ruleResultRows(
  rows: RuleResultSqlRow[],
  rules: Array<{ id: string; name?: string | null }>,
): RuleResultRow[] {
  const index = new Map(rules.map((r, i) => [r.id, { name: r.name ?? null, number: i + 1 }]));
  return rows.map((r) => {
    const known = r.rule_id ? index.get(r.rule_id) : undefined;
    const number = known?.number ?? (r.rule_index !== null && r.rule_index !== undefined ? r.rule_index + 1 : null);
    const label = r.is_default
      ? "Acción por defecto (ninguna regla coincidió)"
      : known?.name
        ? `Regla ${number ?? "?"} · ${known.name}`
        : number !== null
          ? `Regla ${number}`
          : "Una regla que ya no existe";
    return {
      key: `${r.rule_id ?? "default"}:${r.action}`,
      label,
      action: r.action,
      actionLabel: ACTION_LABELS[r.action] ?? r.action,
      runs: Number(r.runs ?? 0),
      degradedToDraft: Number(r.degraded_to_draft ?? 0),
      isDefault: Boolean(r.is_default),
    };
  });
}

/** Como se llaman las acciones del agente en el historial. */
const ACTION_NAMES: Record<string, string> = {
  tag: "Etiquetó",
  temperature: "Cambió la temperatura",
  followup: "Programó un seguimiento",
  assign: "Asignó a una persona",
  human_takeover: "Derivó a una persona",
  agent_paused: "Se pausó",
  "booking.created": "Agendó una reunión",
  "booking.rescheduled": "Movió una reunión",
  "booking.cancelled": "Canceló una reunión",
};

export interface AgentActionRow {
  action: string;
  label: string;
  count: number;
  reverted: number;
}

/** Las acciones del agente, con nombre legible. Las desconocidas se muestran igual. */
export function agentActionRows(rows: Array<{ action: string; actions: number; reverted: number }>): AgentActionRow[] {
  return rows.map((r) => ({
    action: r.action,
    label: ACTION_NAMES[r.action] ?? capitalize(r.action.replace(/[._]/g, " ")),
    count: Number(r.actions ?? 0),
    reverted: Number(r.reverted ?? 0),
  }));
}
