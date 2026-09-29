/**
 * La seccion del agente: cuando se muestra, las tres tasas y su mini linea.
 *
 * Lo que arregla: la seccion se ocultaba SOLO cuando el filtro era una persona.
 * Con "Automatizaciones" o "Fuera del sistema" se mostraba igual, y ahi los
 * numeros del agente no tienen nada que ver con lo que se esta mirando: dicen
 * "el agente actuo en el 86 %" arriba de una pantalla filtrada por flows.
 */

import { share } from "./comparisons";

/** Que se hace con la seccion del agente segun el filtro de autor. */
export type AgentSectionMode = "full" | "hidden-author" | "no-runs";

/**
 * La seccion completa solo con "Todos" o con "Agente IA". Con cualquier otro
 * autor se reemplaza por el aviso con "Ver todos".
 */
export function agentSectionMode(author: string | null, newConversations: number): AgentSectionMode {
  if (author !== null && author !== "agent") return "hidden-author";
  if (newConversations <= 0) return "no-runs";
  return "full";
}

/** El aviso que reemplaza la seccion, con el nombre de lo que se esta filtrando. */
export function hiddenAuthorNotice(authorLabel: string): string {
  return `Estás viendo solo lo que respondió ${authorLabel}. Las métricas del agente se ven con Todos o con Agente IA en “Respondido por”.`;
}

/** Una fila de `chat_dashboard_agent`. */
export interface AgentRow {
  new_conversations: number;
  agent_acted: number;
  agent_took_first: number;
  agent_escalated: number;
}

/** Una fila de `chat_dashboard_agent_weekly`. */
export interface AgentWeekRow {
  week_start: string;
  new_conversations: number;
  acted: number;
  took_first: number;
  escalated: number;
}

export type AgentRateKey = "acted" | "took_first" | "escalated";

export interface AgentRate {
  key: AgentRateKey;
  title: string;
  tooltip: string;
  /** Porcentaje sobre las conversaciones nuevas. null = no hay conversaciones. */
  percent: number | null;
  count: number;
  total: number;
  /** Ocho semanas para la mini linea; null en las semanas sin episodios. */
  weekly: Array<number | null>;
  /** En "Derivó", bajar es bueno. */
  lessIsBetter: boolean;
}

const RATE_META: Record<AgentRateKey, { title: string; tooltip: string; lessIsBetter: boolean }> = {
  acted: {
    title: "Actuó en la conversación",
    tooltip:
      "Hizo al menos una acción: respondió, etiquetó, cambió la temperatura, programó un seguimiento, asignó o derivó.",
    lessIsBetter: false,
  },
  took_first: {
    title: "Tomó desde el primer mensaje",
    tooltip: "El agente fue el primero en responder, aunque después la haya derivado a una persona.",
    lessIsBetter: false,
  },
  escalated: {
    title: "Derivó a una persona",
    tooltip:
      "En algún momento pasó la conversación a alguien del equipo, por regla o porque no supo responder. Que baje es bueno.",
    lessIsBetter: true,
  },
};

/** La tasa semanal de una de las tres metricas. Semana sin episodios = null. */
export function weeklyRate(weeks: AgentWeekRow[], key: AgentRateKey): Array<number | null> {
  return weeks.map((w) => {
    const total = Number(w.new_conversations ?? 0);
    if (total <= 0) return null;
    return share(Number(w[key] ?? 0), total);
  });
}

/** Las tres tarjetas del agente, listas para dibujar. */
export function agentRates(row: AgentRow | null, weeks: AgentWeekRow[]): AgentRate[] {
  const total = Number(row?.new_conversations ?? 0);
  const counts: Record<AgentRateKey, number> = {
    acted: Number(row?.agent_acted ?? 0),
    took_first: Number(row?.agent_took_first ?? 0),
    escalated: Number(row?.agent_escalated ?? 0),
  };
  return (Object.keys(RATE_META) as AgentRateKey[]).map((key) => ({
    key,
    ...RATE_META[key],
    percent: share(counts[key], total),
    count: counts[key],
    total,
    weekly: weeklyRate(weeks, key),
  }));
}

/** Como se llama cada pedazo de "Quién respondió primero". */
export const FIRST_RESPONDER_LABELS: Record<string, string> = {
  agent: "Agente IA",
  automations: "Automatización",
  team: "Persona del equipo",
  external: "Fuera del sistema",
  unanswered: "Todavía sin respuesta",
};

/** El color de cada pedazo. "Sin respuesta" es un hueco, no un autor. */
export const FIRST_RESPONDER_COLORS: Record<string, string> = {
  agent: "var(--c-agent)",
  automations: "var(--c-auto)",
  team: "var(--c-team)",
  external: "var(--c-ext)",
  unanswered: "var(--border)",
};

export const FIRST_RESPONDER_ORDER = ["agent", "automations", "team", "external", "unanswered"];

export interface FirstResponderSlice {
  key: string;
  label: string;
  color: string;
  episodes: number;
  percent: number | null;
}

/** Ordena y porcentualiza "Quién respondió primero". */
export function firstResponderSlices(rows: Array<{ responder: string; episodes: number }>): {
  slices: FirstResponderSlice[];
  total: number;
} {
  const total = rows.reduce((n, r) => n + Number(r.episodes ?? 0), 0);
  const byKey = new Map(rows.map((r) => [r.responder, Number(r.episodes ?? 0)]));
  const slices = FIRST_RESPONDER_ORDER.map((key) => ({
    key,
    label: FIRST_RESPONDER_LABELS[key] ?? key,
    color: FIRST_RESPONDER_COLORS[key] ?? "var(--c-ext)",
    episodes: byKey.get(key) ?? 0,
    percent: share(byKey.get(key) ?? 0, total),
  }));
  return { slices, total };
}
