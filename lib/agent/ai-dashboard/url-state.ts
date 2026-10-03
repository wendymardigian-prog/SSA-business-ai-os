import { isPeriodPreset, type PeriodPreset } from "@/lib/dashboards/period";

/**
 * El período del mini dashboard de IA y de Corridas, en la URL (A2, R1).
 *
 * Mismo vocabulario y mismos nombres de parametro que el dashboard de Chat
 * (`range`, `from`, `to`): un solo vocabulario de periodo en toda la app
 * nueva, en vez de sumar un tercero (D6 del documento habla de dos; este es
 * el mismo `range` del Chat, no uno nuevo). `lib/dashboards/url-state.ts` no
 * se reusa tal cual porque ata `channel`/`author`, que ni Agentes ni Corridas
 * tienen.
 */
export interface PeriodFilter {
  period: PeriodPreset;
  from: string | null;
  to: string | null;
}

export const DEFAULT_AI_PERIOD: PeriodPreset = "30d";

function validInstant(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : raw;
}

export function parsePeriodFilter(params: URLSearchParams): PeriodFilter {
  const range = params.get("range");
  const from = validInstant(params.get("from"));
  const to = validInstant(params.get("to"));
  const custom = from !== null && to !== null;
  return {
    period: range && isPeriodPreset(range) ? range : DEFAULT_AI_PERIOD,
    from: custom ? from : null,
    to: custom ? to : null,
  };
}

/** Solo lo que difiere del default, igual que el dashboard de Chat. */
export function periodFilterToParams(filter: PeriodFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (filter.from && filter.to) {
    p.set("from", filter.from);
    p.set("to", filter.to);
  } else if (filter.period !== DEFAULT_AI_PERIOD) {
    p.set("range", filter.period);
  }
  return p;
}
