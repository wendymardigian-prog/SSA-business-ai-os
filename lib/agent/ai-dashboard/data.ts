/**
 * Datos del mini dashboard de IA (A1-A5), server-side con service role.
 *
 * A lo sumo tres llamadas para las cinco tarjetas y el grafico de barras: el
 * informe del periodo, el del periodo anterior (una sola vez, no cuatro) y la
 * serie por dia. Una cuarta, `ai_runs_scatter`, solo si se abre la pestaña de
 * puntos (`loadAiScatter`, aparte).
 *
 * Todo lo que toca `cost_usd` o tokens pasa por aca, nunca por el cliente del
 * usuario (00060): quien llama ya paso por `requirePermission("ai_costs.view")`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { previousPeriod, resolvePeriod, type ResolvedPeriod } from "@/lib/dashboards/period";
import { civilDate } from "@/lib/dates";
import { addDays, toKey } from "@/lib/dashboards/chat/date-range";
import { fetchCostReport, type RawReport } from "@/lib/agent/costs-query";
import type { PeriodFilter } from "./url-state";
import type { PeriodTotals } from "./kpis";
import type { SpendByDayRow } from "./spend-chart";
import type { ScatterRunRow } from "./scatter-points";

type Db = SupabaseClient<Database>;

const n = (v: unknown): number => Number(v ?? 0);

/** El rango elegido y, si no es "historico", el anterior para comparar (D6). */
export function resolveAiRange(
  filter: PeriodFilter,
  timeZone: string,
  now: Date = new Date(),
): { range: ResolvedPeriod; previous: ResolvedPeriod } {
  const range = filter.from && filter.to ? { from: filter.from, to: filter.to } : resolvePeriod(filter.period, now, timeZone);
  return { range, previous: previousPeriod(range, now) };
}

function totalsFrom(raw: RawReport | null): PeriodTotals {
  if (!raw) return { runs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, embeddingTokens: 0, missingPricing: 0 };
  return {
    runs: raw.totals.runs,
    costUsd: n(raw.totals.cost_usd),
    inputTokens: n(raw.totals.input_tokens),
    outputTokens: n(raw.totals.output_tokens),
    cachedTokens: n(raw.totals.cached_tokens),
    embeddingTokens: n(raw.totals.embedding_tokens),
    missingPricing: raw.totals.missing_pricing,
  };
}

interface RawSpendRow {
  day: string;
  source: string | null;
  runs: number;
  cost_usd: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  missing_pricing: number;
}

export interface AiDashboardData {
  range: ResolvedPeriod;
  previousRange: ResolvedPeriod;
  totals: PeriodTotals;
  /** null en "historico": no hay periodo anterior con que comparar. */
  previousTotals: PeriodTotals | null;
  spendByDay: SpendByDayRow[];
  /** null si hoy (o ayer) no cae dentro del periodo elegido. */
  todayCost: number | null;
  yesterdayCost: number | null;
}

export async function loadAiDashboardData(
  service: Db,
  args: { workspaceId: string; filter: PeriodFilter; timeZone: string; now?: Date },
): Promise<AiDashboardData> {
  const now = args.now ?? new Date();
  const { range, previous } = resolveAiRange(args.filter, args.timeZone, now);
  const hasPrevious = previous.from !== null && previous.to !== null;

  const [raw, previousRaw, spendRes] = await Promise.all([
    fetchCostReport(service, {
      workspaceId: args.workspaceId,
      from: range.from ? new Date(range.from) : new Date(0),
      to: range.to ? new Date(range.to) : new Date(now.getTime() + 60_000),
    }),
    hasPrevious
      ? fetchCostReport(service, { workspaceId: args.workspaceId, from: new Date(previous.from as string), to: new Date(previous.to as string) })
      : Promise.resolve(null),
    service.rpc("ai_spend_by_day", {
      p_workspace_id: args.workspaceId,
      p_from: range.from,
      p_to: range.to,
      p_tz: args.timeZone,
    }),
  ]);

  if (spendRes.error) console.error("[ai-dashboard] no pude leer el gasto por dia:", spendRes.error.message);
  const spendByDay: SpendByDayRow[] = ((spendRes.data as unknown as RawSpendRow[] | null) ?? []).map((r) => ({
    day: r.day,
    source: r.source,
    runs: r.runs,
    cost_usd: n(r.cost_usd),
    input_tokens: n(r.input_tokens),
    output_tokens: n(r.output_tokens),
    missing_pricing: r.missing_pricing,
  }));

  const todayKey = toKey(civilDate(now, args.timeZone));
  const yesterdayKey = toKey(addDays(civilDate(now, args.timeZone), -1));
  const costOfDay = (key: string): number | null => {
    const rows = spendByDay.filter((r) => r.day === key);
    if (rows.length === 0) return null; // ese dia no esta en el periodo elegido.
    return rows.reduce((sum, r) => sum + r.cost_usd, 0);
  };

  return {
    range,
    previousRange: previous,
    totals: totalsFrom(raw),
    previousTotals: hasPrevious ? totalsFrom(previousRaw) : null,
    spendByDay,
    todayCost: costOfDay(todayKey),
    yesterdayCost: costOfDay(yesterdayKey),
  };
}

interface RawScatterRow {
  id: string;
  created_at: string;
  source: string;
  status: string;
  cost_usd: number | string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  total_tokens: number | string;
  conversation_id: string | null;
}

/** Solo cuando se abre la pestaña de puntos (A6: la cuarta llamada). */
export async function loadAiScatter(
  service: Db,
  args: { workspaceId: string; range: ResolvedPeriod },
): Promise<ScatterRunRow[]> {
  const { data, error } = await service.rpc("ai_runs_scatter", {
    p_workspace_id: args.workspaceId,
    p_from: args.range.from,
    p_to: args.range.to,
  });
  if (error) {
    console.error("[ai-dashboard] no pude leer la dispersion de corridas:", error.message);
    return [];
  }
  return ((data as unknown as RawScatterRow[] | null) ?? []).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    source: r.source,
    status: r.status,
    cost_usd: r.cost_usd === null ? null : n(r.cost_usd),
    latency_ms: r.latency_ms,
    input_tokens: r.input_tokens,
    total_tokens: n(r.total_tokens),
    conversation_id: r.conversation_id,
  }));
}
