/**
 * Un loader por bloque del dashboard de Chat.
 *
 * La pagina crea estas promesas SIN esperarlas y se las pasa al componente: cada
 * bloque aparece cuando llega el suyo, en vez de que la pantalla entera espere a
 * la consulta mas lenta. Ninguno lanza (ver `result.ts`).
 *
 * Todas las funciones son SECURITY INVOKER y se llaman con el cliente del
 * usuario: la RLS aplica el scope de leads sin que la app filtre nada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { resolvePeriod, previousPeriod, type PeriodPreset, type ResolvedPeriod } from "@/lib/dashboards/period";
import type { DashboardFilters } from "@/lib/dashboards/url-state";
import { blockResult, fromRpc } from "./result";
import type { BlockResult } from "./types";
import { bucketTrends, daysBetween, shouldGroupWeekly, trendTotals, type TrendBucket, type TrendRow } from "./trends";
import { agentRates, firstResponderSlices, type AgentRate, type AgentRow, type AgentWeekRow, type FirstResponderSlice } from "./agent";
import { buildTeamRows, type TeamRow, type TeamSqlRow } from "./team-rows";
import { draftsCard, type DraftsCard, type DraftsSqlRow } from "./drafts";
import { agentActionRows, escalationReasons, ruleResultRows, type AgentActionRow, type EscalationReason, type EscalationSqlRow, type RuleResultRow, type RuleResultSqlRow } from "./escalations";
import { patternCategories, repliesPanel, type PatternCategory, type PatternSqlRow, type RepliesPanel, type ReplySqlRow } from "./patterns";

type Db = SupabaseClient<Database>;

/** Los parametros que comparten todas las funciones. */
export interface ChatQueryArgs {
  workspaceId: string;
  timezone: string;
  range: ResolvedPeriod;
  previous: ResolvedPeriod;
  channel: string | null;
  author: string | null;
  /** Dias del periodo: decide si las tendencias se agrupan por semana. */
  days: number;
}

/** Resuelve el rango y el periodo anterior una sola vez, para todos los bloques. */
export function chatQueryArgs(args: {
  workspaceId: string;
  filters: DashboardFilters;
  timezone: string;
  now?: Date;
}): ChatQueryArgs {
  const now = args.now ?? new Date();
  const range =
    args.filters.from && args.filters.to
      ? { from: args.filters.from, to: args.filters.to }
      : resolvePeriod(args.filters.period as PeriodPreset, now, args.timezone);
  return {
    workspaceId: args.workspaceId,
    timezone: args.timezone,
    range,
    previous: previousPeriod(range, now),
    channel: args.filters.channel,
    author: args.filters.author,
    days: daysBetween(range.from, range.to, now),
  };
}

function common(a: ChatQueryArgs) {
  return { p_workspace_id: a.workspaceId, p_from: a.range.from, p_to: a.range.to, p_channel: a.channel };
}

// ---------------------------------------------------------------------------
// Numeros y espera
// ---------------------------------------------------------------------------

export interface NumbersBlock {
  newConversations: number;
  messagesIn: number;
  messagesOut: number;
  firstResponseMedianSeconds: number | null;
}

export interface CardsBlock {
  current: NumbersBlock;
  /** null cuando no hay con que comparar (Historico). */
  previous: NumbersBlock | null;
  waitingNow: number;
}

function numbers(row: Record<string, unknown> | undefined): NumbersBlock {
  return {
    newConversations: Number(row?.new_conversations ?? 0),
    messagesIn: Number(row?.messages_in ?? 0),
    messagesOut: Number(row?.messages_out ?? 0),
    firstResponseMedianSeconds:
      row?.first_response_median_seconds === null || row?.first_response_median_seconds === undefined
        ? null
        : Number(row.first_response_median_seconds),
  };
}

export function loadCards(client: Db, a: ChatQueryArgs): Promise<BlockResult<CardsBlock>> {
  return blockResult<CardsBlock>("los números principales", async () => {
    const [cur, prev, waiting] = await Promise.all([
      client.rpc("chat_dashboard_numbers", { ...common(a), p_author: a.author }),
      a.previous.from
        ? client.rpc("chat_dashboard_numbers", {
            p_workspace_id: a.workspaceId,
            p_from: a.previous.from,
            p_to: a.previous.to,
            p_channel: a.channel,
            p_author: a.author,
          })
        : Promise.resolve({ data: null, error: null }),
      client.rpc("chat_waiting_now", { p_workspace_id: a.workspaceId, p_channel: a.channel }),
    ]);
    if (cur.error) return { error: cur.error.message };
    if (prev.error) return { error: prev.error.message };
    if (waiting.error) return { error: waiting.error.message };
    const rows = (cur.data ?? []) as Record<string, unknown>[];
    const prevRows = (prev.data ?? []) as Record<string, unknown>[] | null;
    return {
      data: {
        current: numbers(rows[0]),
        previous: a.previous.from ? numbers(prevRows?.[0]) : null,
        waitingNow: Number((waiting.data as number | null) ?? 0),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Tendencias
// ---------------------------------------------------------------------------

export interface TrendsBlock {
  buckets: TrendBucket[];
  weekly: boolean;
  totals: ReturnType<typeof trendTotals>;
}

export function loadTrends(client: Db, a: ChatQueryArgs): Promise<BlockResult<TrendsBlock>> {
  return blockResult("las tendencias", async () => {
    const res = await client.rpc("chat_dashboard_trends", { ...common(a), p_author: a.author, p_tz: a.timezone });
    return fromRpc<TrendRow, TrendsBlock>(res, (rows) => {
      const weekly = shouldGroupWeekly(a.days);
      const buckets = bucketTrends(rows, weekly);
      return { buckets, weekly, totals: trendTotals(buckets) };
    });
  });
}

// ---------------------------------------------------------------------------
// El agente
// ---------------------------------------------------------------------------

export interface AgentBlock {
  newConversations: number;
  rates: AgentRate[];
  /** Comparacion en puntos con el periodo anterior, por metrica. */
  previousPercent: Record<string, number | null>;
}

export function loadAgent(client: Db, a: ChatQueryArgs): Promise<BlockResult<AgentBlock>> {
  return blockResult<AgentBlock>("las métricas del agente", async () => {
    const [cur, prev, weekly] = await Promise.all([
      client.rpc("chat_dashboard_agent", common(a)),
      a.previous.from
        ? client.rpc("chat_dashboard_agent", {
            p_workspace_id: a.workspaceId,
            p_from: a.previous.from,
            p_to: a.previous.to,
            p_channel: a.channel,
          })
        : Promise.resolve({ data: null, error: null }),
      client.rpc("chat_dashboard_agent_weekly", { p_workspace_id: a.workspaceId, p_channel: a.channel, p_tz: a.timezone, p_weeks: 8 }),
    ]);
    if (cur.error) return { error: cur.error.message };
    if (weekly.error) return { error: weekly.error.message };

    const row = ((cur.data ?? []) as AgentRow[])[0] ?? null;
    const weeks = (weekly.data ?? []) as AgentWeekRow[];
    const prevRow = prev.error ? null : (((prev.data ?? []) as AgentRow[])[0] ?? null);

    const prevTotal = Number(prevRow?.new_conversations ?? 0);
    const pct = (n: number | undefined) => (prevTotal > 0 ? Math.round((Number(n ?? 0) / prevTotal) * 100) : null);

    return {
      data: {
        newConversations: Number(row?.new_conversations ?? 0),
        rates: agentRates(row, weeks),
        previousPercent: {
          acted: pct(prevRow?.agent_acted),
          took_first: pct(prevRow?.agent_took_first),
          escalated: pct(prevRow?.agent_escalated),
        },
      },
    };
  });
}

export interface FirstResponderBlock {
  slices: FirstResponderSlice[];
  total: number;
}

export function loadFirstResponder(client: Db, a: ChatQueryArgs): Promise<BlockResult<FirstResponderBlock>> {
  return blockResult("quién respondió primero", async () => {
    const res = await client.rpc("chat_dashboard_first_responder", common(a));
    return fromRpc<{ responder: string; episodes: number }, FirstResponderBlock>(res, (rows) => firstResponderSlices(rows));
  });
}

export function loadEscalationReasons(client: Db, a: ChatQueryArgs): Promise<BlockResult<EscalationReason[]>> {
  return blockResult("por qué derivó", async () => {
    const res = await client.rpc("chat_dashboard_escalation_reasons", { ...common(a), p_limit: 6 });
    return fromRpc<EscalationSqlRow, EscalationReason[]>(res, escalationReasons);
  });
}

export function loadAgentActions(client: Db, a: ChatQueryArgs): Promise<BlockResult<AgentActionRow[]>> {
  return blockResult("las acciones del agente", async () => {
    const res = await client.rpc("chat_dashboard_agent_actions", common(a));
    return fromRpc<{ action: string; actions: number; reverted: number }, AgentActionRow[]>(res, agentActionRows);
  });
}

export function loadRuleResults(
  client: Db,
  a: ChatQueryArgs,
  rules: Array<{ id: string; name?: string | null }>,
): Promise<BlockResult<RuleResultRow[]>> {
  return blockResult("los resultados de las reglas", async () => {
    const res = await client.rpc("chat_dashboard_rule_results", common(a));
    return fromRpc<RuleResultSqlRow, RuleResultRow[]>(res, (rows) => ruleResultRows(rows, rules));
  });
}

export function loadDrafts(client: Db, a: ChatQueryArgs): Promise<BlockResult<DraftsCard>> {
  return blockResult("la aprobación de respuestas", async () => {
    const res = await client.rpc("chat_dashboard_drafts", { ...common(a), p_tz: a.timezone });
    return fromRpc<DraftsSqlRow, DraftsCard>(res, (rows) => draftsCard(rows[0] ?? null));
  });
}

// ---------------------------------------------------------------------------
// Quien responde
// ---------------------------------------------------------------------------

export function loadTeam(
  client: Db,
  a: ChatQueryArgs,
  members: Array<{ id: string; label: string; role: string }>,
  currentUserId?: string,
): Promise<BlockResult<TeamRow[]>> {
  return blockResult("la tabla de quién responde", async () => {
    const res = await client.rpc("chat_dashboard_team", common(a));
    return fromRpc<TeamSqlRow, TeamRow[]>(res, (rows) => buildTeamRows(rows, members, currentUserId));
  });
}

// ---------------------------------------------------------------------------
// Patrones
// ---------------------------------------------------------------------------

export interface PatternsBlock {
  outbound: PatternCategory[];
  inbound: PatternCategory[];
}

export function loadPatterns(client: Db, a: ChatQueryArgs): Promise<BlockResult<PatternsBlock>> {
  return blockResult<PatternsBlock>("los patrones de mensajes", async () => {
    const [out, inb] = await Promise.all([
      client.rpc("chat_dashboard_patterns", {
        p_workspace_id: a.workspaceId,
        p_direction: "outbound",
        p_from: a.range.from,
        p_to: a.range.to,
        p_channel: a.channel,
        p_author: a.author,
      }),
      client.rpc("chat_dashboard_patterns", {
        p_workspace_id: a.workspaceId,
        p_direction: "inbound",
        p_from: a.range.from,
        p_to: a.range.to,
        p_channel: a.channel,
        p_author: null,
      }),
    ]);
    if (out.error) return { error: out.error.message };
    if (inb.error) return { error: inb.error.message };
    return {
      data: {
        outbound: patternCategories((out.data ?? []) as PatternSqlRow[]),
        inbound: patternCategories((inb.data ?? []) as PatternSqlRow[]),
      },
    };
  });
}

export function loadReplies(client: Db, a: ChatQueryArgs, categoryId: string): Promise<BlockResult<RepliesPanel>> {
  return blockResult("qué le responden", async () => {
    const res = await client.rpc("chat_dashboard_replies", {
      p_workspace_id: a.workspaceId,
      p_category_id: categoryId,
      p_from: a.range.from,
      p_to: a.range.to,
      p_channel: a.channel,
    });
    return fromRpc<ReplySqlRow, RepliesPanel>(res, repliesPanel);
  });
}

export interface QualityLine {
  lastRunAt: string | null;
  lastRunStatus: string | null;
  classifiedToday: number;
  unclassifiedPending: number;
  /** Precision estimada y corregidos salen de las revisiones, no de la corrida. */
  accuracyPct: number | null;
  reviewedCount: number;
  correctedPct: number | null;
}

/**
 * La linea de calidad del pie de Patrones.
 *
 * Usa las mismas formulas que la pantalla de Tareas (`lib/patterns/quality.ts`):
 * una precision que se calcule de dos maneras distintas termina en dos numeros
 * distintos y nadie sabe cual creer.
 */
export function loadQualityLine(client: Db, a: ChatQueryArgs): Promise<BlockResult<QualityLine>> {
  return blockResult<QualityLine>("la calidad de la clasificación", async () => {
    const [status, volumes] = await Promise.all([
      client.rpc("message_classification_status", { p_workspace_id: a.workspaceId, p_tz: a.timezone }),
      client.rpc("message_text_volumes", { p_workspace_id: a.workspaceId, p_direction: null, p_from: a.range.from, p_to: a.range.to }),
    ]);
    if (status.error) return { error: status.error.message };
    if (volumes.error) return { error: volumes.error.message };

    const s = ((status.data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
    const texts = (volumes.data ?? []) as Array<{ source: string | null; review_result: string | null }>;
    const reviewed = texts.filter((t) => t.review_result !== null);
    const okCount = reviewed.filter((t) => t.review_result === "ok").length;
    const modelTexts = texts.filter((t) => t.source === "model");
    const correctedCount = modelTexts.filter((t) => t.review_result === "corrected").length;

    return {
      data: {
        lastRunAt: (s.last_run_at as string | null) ?? null,
        lastRunStatus: (s.last_run_status as string | null) ?? null,
        classifiedToday: Number(s.texts_classified_today ?? 0),
        unclassifiedPending: Number(s.unclassified_pending ?? 0),
        accuracyPct: reviewed.length > 0 ? Math.round((okCount / reviewed.length) * 100) : null,
        reviewedCount: reviewed.length,
        correctedPct: modelTexts.length > 0 ? Math.round((correctedCount / modelTexts.length) * 100) : null,
      },
    };
  });
}
