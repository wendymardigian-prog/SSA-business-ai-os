import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { BUSINESS_TIMEZONE, DATE_PRESETS, DATE_PRESET_LABELS, resolveDateRange, startOfZonedDay, startOfZonedMonth, type DatePreset } from "@/lib/dates";
import { firstParam, pickEnum, type SearchParams } from "@/lib/url-params";
import { RUN_SOURCE_LABELS } from "./run-labels";
import type { AgentConfig } from "./config";
import type { CostFilters, CostReport, CostsTabData, HeaderKpis } from "./screen";

/**
 * La pestana Costos (F29): agregados del periodo via ai_cost_report (00069),
 * siempre con service role y detras de requireWorkspaceAdmin. Un Member no ve
 * la pestana, y aunque llegara a la URL, la pagina no carga estos datos.
 *
 * Los cortes de dia y de mes (los indicadores de la cabecera, "gasto del mes")
 * van en la zona del negocio, igual que los topes de gasto.
 */

type Db = SupabaseClient<Database>;

export const COSTS_DEFAULT_PRESET: DatePreset = "30d";

export function parseCostFilters(params: SearchParams): CostFilters {
  return {
    datePreset: pickEnum<DatePreset, DatePreset>(params.fecha, DATE_PRESETS, COSTS_DEFAULT_PRESET),
    dateFrom: firstParam(params.desde),
    dateTo: firstParam(params.hasta),
  };
}

interface RawReport {
  totals: {
    runs: number;
    cost_usd: number | string;
    conversations: number;
    escalations: number;
    responded: number;
    missing_pricing: number;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    embedding_tokens: number;
  };
  by_source: Array<{ source: string; runs: number; cost_usd: number | string }>;
  by_agent: Array<{ agent_id: string | null; runs: number; cost_usd: number | string }>;
  by_model: Array<{ provider: string | null; model: string; runs: number; cost_usd: number | string; input_tokens: number; output_tokens: number; missing_pricing: number }>;
  top_conversations: Array<{ conversation_id: string; contact_id: string | null; runs: number; cost_usd: number | string }>;
}

const n = (v: number | string | null | undefined) => Number(v ?? 0);

export async function fetchCostReport(service: Db, args: { workspaceId: string; from: Date; to: Date }): Promise<RawReport | null> {
  const { data, error } = await service.rpc("ai_cost_report", {
    p_workspace_id: args.workspaceId,
    p_from: args.from.toISOString(),
    p_to: args.to.toISOString(),
  });
  if (error) {
    console.error("[costs] no pude leer el reporte:", error.message);
    return null;
  }
  return (data as unknown as RawReport | null) ?? null;
}

/** Los indicadores de la cabecera del agente: runs de hoy, gasto del mes, % de derivaciones. */
export async function loadHeaderKpis(service: Db, args: { workspaceId: string; agentId: string; now?: Date }): Promise<HeaderKpis> {
  const now = args.now ?? new Date();
  const dayStart = startOfZonedDay(now, BUSINESS_TIMEZONE);
  const monthStart = startOfZonedMonth(now, BUSINESS_TIMEZONE);
  const soon = new Date(now.getTime() + 60_000);

  const [{ count: runsToday }, month] = await Promise.all([
    service.from("agent_runs").select("id", { count: "exact", head: true }).eq("workspace_id", args.workspaceId).eq("agent_id", args.agentId).gte("created_at", dayStart.toISOString()),
    fetchCostReport(service, { workspaceId: args.workspaceId, from: monthStart, to: soon }),
  ]);
  const totals = month?.totals;
  const decided = (totals?.responded ?? 0) + (totals?.escalations ?? 0);
  return {
    runsToday: runsToday ?? 0,
    monthCostUsd: totals ? n(totals.cost_usd) : null,
    escalationRatePct: decided > 0 ? Math.round(((totals?.escalations ?? 0) / decided) * 100) : null,
    missingPricing: totals?.missing_pricing ?? 0,
  };
}

export async function loadCostsTab(
  service: Db,
  args: {
    workspaceId: string;
    agent: AgentConfig;
    filters: CostFilters;
    agentNames: Map<string, string>;
    workspaceLimits: { daily: number | null; monthly: number | null };
    canEditPricing: boolean;
    now?: Date;
  },
): Promise<CostsTabData> {
  const now = args.now ?? new Date();
  const range = resolveDateRange(args.filters.datePreset, args.filters.dateFrom, args.filters.dateTo, now, BUSINESS_TIMEZONE);
  const from = range.from ? new Date(range.from) : new Date(0);
  const to = range.to ? new Date(range.to) : new Date(now.getTime() + 60_000);

  const [raw, pricingRes] = await Promise.all([
    fetchCostReport(service, { workspaceId: args.workspaceId, from, to }),
    service
      .from("model_pricing")
      .select("id, provider, model, input_per_mtok, output_per_mtok, cached_input_per_mtok, valid_from, note")
      .eq("workspace_id", args.workspaceId)
      .order("provider")
      .order("model")
      .order("valid_from", { ascending: false }),
  ]);

  const report: CostReport = raw
    ? {
        totals: {
          runs: raw.totals.runs,
          costUsd: n(raw.totals.cost_usd),
          conversations: raw.totals.conversations,
          escalations: raw.totals.escalations,
          responded: raw.totals.responded,
          missingPricing: raw.totals.missing_pricing,
          inputTokens: raw.totals.input_tokens,
          outputTokens: raw.totals.output_tokens,
          cachedTokens: raw.totals.cached_tokens,
          embeddingTokens: raw.totals.embedding_tokens,
        },
        bySource: raw.by_source.map((s) => ({ source: s.source, label: RUN_SOURCE_LABELS[s.source] ?? s.source, runs: s.runs, costUsd: n(s.cost_usd) })),
        byAgent: raw.by_agent.map((a) => ({ agentId: a.agent_id, name: a.agent_id ? args.agentNames.get(a.agent_id) ?? "Agente borrado" : "Sin agente (flows, secuencias, indexación)", runs: a.runs, costUsd: n(a.cost_usd) })),
        byModel: raw.by_model.map((m) => ({ provider: m.provider, model: m.model, runs: m.runs, costUsd: n(m.cost_usd), inputTokens: m.input_tokens, outputTokens: m.output_tokens, missingPricing: m.missing_pricing })),
        topConversations: raw.top_conversations.map((t) => ({ conversationId: t.conversation_id, contactId: t.contact_id, contactName: null, runs: t.runs, costUsd: n(t.cost_usd) })),
      }
    : emptyReport();

  // Nombres de los contactos del top 10, en una consulta.
  const contactIds = report.topConversations.map((t) => t.contactId).filter((id): id is string => Boolean(id));
  if (contactIds.length > 0) {
    const { data: contacts } = await service.from("contacts").select("id, display_name").in("id", contactIds);
    const names = new Map((contacts ?? []).map((c) => [c.id, c.display_name]));
    for (const t of report.topConversations) t.contactName = t.contactId ? names.get(t.contactId) ?? null : null;
  }

  const totals = report.totals;
  const decided = totals.responded + totals.escalations;
  return {
    filters: args.filters,
    rangeLabel: args.filters.datePreset === "custom" ? `${args.filters.dateFrom || "…"} a ${args.filters.dateTo || "hoy"}` : DATE_PRESET_LABELS[args.filters.datePreset],
    report,
    averages: {
      perRun: totals.runs > 0 ? totals.costUsd / totals.runs : null,
      perConversation: totals.conversations > 0 ? totals.costUsd / totals.conversations : null,
      perEscalation: totals.escalations > 0 ? totals.costUsd / totals.escalations : null,
      escalationRatePct: decided > 0 ? Math.round((totals.escalations / decided) * 100) : null,
    },
    limits: {
      agentDailyUsd: args.agent.dailyCostLimitUsd,
      agentDailyAction: args.agent.dailyCostLimitAction,
      agentMonthlyUsd: args.agent.monthlyCostLimitUsd,
      agentMonthlyAction: args.agent.monthlyCostLimitAction,
      workspaceDailyUsd: args.workspaceLimits.daily,
      workspaceMonthlyUsd: args.workspaceLimits.monthly,
    },
    pricing: (pricingRes.data ?? []).map((p) => ({
      id: p.id,
      provider: p.provider,
      model: p.model,
      inputPerMtok: Number(p.input_per_mtok),
      outputPerMtok: Number(p.output_per_mtok),
      cachedInputPerMtok: Number(p.cached_input_per_mtok),
      validFrom: p.valid_from,
      note: p.note,
    })),
    canEditPricing: args.canEditPricing,
  };
}

function emptyReport(): CostReport {
  return {
    totals: { runs: 0, costUsd: 0, conversations: 0, escalations: 0, responded: 0, missingPricing: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, embeddingTokens: 0 },
    bySource: [],
    byAgent: [],
    byModel: [],
    topConversations: [],
  };
}
