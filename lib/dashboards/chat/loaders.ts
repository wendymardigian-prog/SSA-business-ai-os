/**
 * Un loader por bloque del dashboard de Chat.
 *
 * La pagina crea estas promesas SIN esperarlas y se las pasa al componente: cada
 * bloque aparece cuando llega el suyo, en vez de que la pantalla entera espere a
 * la consulta mas lenta. Ninguno lanza (ver `result.ts`).
 *
 * Se llaman con el cliente del usuario, asi la app no filtra nada: el alcance de
 * leads lo aplica la base. Las funciones pesadas (`chat_dashboard_core`, `_v2`) son
 * SECURITY DEFINER y deciden el permiso una vez por conversacion, con la misma regla
 * que la RLS (`can_see_conversation`, ver la 00305); el resto son INVOKER.
 *
 * Todas pasan por `chatRpc` (`rpc.ts`): la cola, el reintento y el texto claro.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { resolvePeriod, previousPeriod, type PeriodPreset, type ResolvedPeriod } from "@/lib/dashboards/period";
import type { DashboardFilters } from "@/lib/dashboards/url-state";
import { blockResult, fromRpc } from "./result";
import { chatQuery, chatRpc, type ChatQueryResult } from "./rpc";
import type { BlockResult } from "./types";
import {
  bucketTrends,
  daysBetween,
  shouldGroupWeekly,
  trendTotals,
  withResponseTimes,
  type ResponseDayRow,
  type TrendBucket,
  type TrendRow,
} from "./trends";
import { agentRates, firstResponderSlices, type AgentRate, type AgentRow, type AgentWeekRow, type FirstResponderSlice } from "./agent";
import { buildTeamRows, type TeamRow, type TeamSqlRow } from "./team-rows";
import { draftsCard, type DraftsCard, type DraftsSqlRow } from "./drafts";
import { agentActionRows, escalationReasons, ruleResultRows, type AgentActionRow, type EscalationReason, type EscalationSqlRow, type RuleResultRow, type RuleResultSqlRow } from "./escalations";
import { patternCategories, repliesPanel, type PatternCategory, type PatternSqlRow, type RepliesPanel, type ReplySqlRow } from "./patterns";

type Db = SupabaseClient<Database>;

/** Una cuenta sobre `message_texts`, con sus filtros todavia por poner. */
type TextCountQuery = ReturnType<ReturnType<ReturnType<Db["from"]>["select"]>["eq"]>;

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
  /**
   * Tiempo de respuesta (00261): promedio y mediana de las esperas del lead que
   * cerro una persona (o el autor filtrado). null = no hubo ninguna.
   */
  responseAvgSeconds: number | null;
  responseMedianSeconds: number | null;
  responseTurns: number;
}

/** Esperando respuesta ahora (00259), en tres. No depende del periodo. */
export interface WaitingNow {
  /** Todavia se pueden responder desde el sistema. */
  canReply: number;
  /** La ventana de la red ya se cerro: solo desde la app. */
  windowClosed: number;
  /** El ultimo mensaje solo cierra la charla (o alguien lo marco asi). */
  noReplyNeeded: number;
}

export interface CardsBlock {
  current: NumbersBlock;
  /** null cuando no hay con que comparar (Historico). */
  previous: NumbersBlock | null;
  waitingNow: WaitingNow;
}

const nullableNumber = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function numbers(row: Record<string, unknown> | undefined, response: Record<string, unknown> | undefined): NumbersBlock {
  return {
    newConversations: Number(row?.new_conversations ?? 0),
    messagesIn: Number(row?.messages_in ?? 0),
    messagesOut: Number(row?.messages_out ?? 0),
    responseAvgSeconds: nullableNumber(response?.avg_seconds),
    responseMedianSeconds: nullableNumber(response?.median_seconds),
    responseTurns: Number(response?.turns ?? 0),
  };
}

/** Lo que devuelve `chat_dashboard_core` (00305). */
export interface ChatCore {
  numbers: Record<string, unknown>;
  numbers_prev: Record<string, unknown> | null;
  response: Record<string, unknown>;
  response_prev: Record<string, unknown> | null;
  trends: TrendRow[];
  response_daily: ResponseDayRow[];
  first_responder: Array<{ responder: string; episodes: number }> | null;
  agent: AgentRow | null;
  agent_prev: AgentRow | null;
  agent_weekly: AgentWeekRow[] | null;
}

/**
 * Cifras, tendencias y seccion del agente salen de UNA consulta. Cada bloque la
 * pide y comparten la que esta en curso (`blocks.ts`).
 */
export async function loadChatCore(client: Db, a: ChatQueryArgs, includeAgent: boolean): Promise<{ data: ChatCore } | { error: string }> {
  const res = await chatRpc(client, "chat_dashboard_core", {
    p_workspace_id: a.workspaceId,
    p_from: a.range.from,
    p_to: a.range.to,
    p_prev_from: a.previous.from,
    p_prev_to: a.previous.to,
    p_channel: a.channel,
    p_author: a.author,
    p_tz: a.timezone,
    p_include_agent: includeAgent,
  });
  if (res.error) return { error: res.error.message };
  return { data: res.data as ChatCore };
}

/** Lo que falta para armar un bloque: la consulta compartida y un error se dicen igual. */
export type LoadCore = () => Promise<BlockResult<ChatCore>>;

/**
 * Corre un bloque que sale de la consulta compartida.
 *
 * Adentro de `blockResult`: un `.then(map)` suelto que lanzara rechazaria la promesa
 * que lee `use()`, y eso si tira la pantalla abajo.
 */
function fromCore<T>(label: string, core: LoadCore, map: (data: ChatCore) => T): Promise<BlockResult<T>> {
  return blockResult<T>(label, async () => {
    const result = await core();
    if (!result.ok) return { error: result.error };
    return { data: map(result.data) };
  });
}

export function loadCards(client: Db, a: ChatQueryArgs, core: LoadCore): Promise<BlockResult<CardsBlock>> {
  return blockResult<CardsBlock>("los números principales", async () => {
    const [result, waiting] = await Promise.all([
      core(),
      chatRpc(client, "chat_waiting_now_v2", { p_workspace_id: a.workspaceId, p_channel: a.channel }),
    ]);
    if (!result.ok) return { error: result.error };
    if (waiting.error) return { error: waiting.error.message };
    const w = ((waiting.data ?? []) as Record<string, unknown>[])[0];
    const data = result.data;
    return {
      data: {
        current: numbers(data.numbers, data.response),
        previous: data.numbers_prev ? numbers(data.numbers_prev, data.response_prev ?? undefined) : null,
        waitingNow: {
          canReply: Number(w?.can_reply ?? 0),
          windowClosed: Number(w?.window_closed ?? 0),
          noReplyNeeded: Number(w?.no_reply_needed ?? 0),
        },
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

export function loadTrends(a: ChatQueryArgs, core: LoadCore): Promise<BlockResult<TrendsBlock>> {
  return fromCore("las tendencias", core, (data) => {
    // La serie de siempre y la del tiempo de respuesta se juntan por dia antes de agrupar.
    const weekly = shouldGroupWeekly(a.days);
    const buckets = bucketTrends(withResponseTimes(data.trends, data.response_daily), weekly);
    return { buckets, weekly, totals: trendTotals(buckets) };
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

export function loadAgent(core: LoadCore): Promise<BlockResult<AgentBlock>> {
  return fromCore("las métricas del agente", core, (data) => {
    const row = data.agent;
    const prevRow = data.agent_prev;
    const prevTotal = Number(prevRow?.new_conversations ?? 0);
    const pct = (n: number | undefined) => (prevTotal > 0 ? Math.round((Number(n ?? 0) / prevTotal) * 100) : null);
    return {
      newConversations: Number(row?.new_conversations ?? 0),
      rates: agentRates(row, data.agent_weekly ?? []),
      previousPercent: {
        acted: pct(prevRow?.agent_acted),
        took_first: pct(prevRow?.agent_took_first),
        escalated: pct(prevRow?.agent_escalated),
      },
    };
  });
}

export interface FirstResponderBlock {
  slices: FirstResponderSlice[];
  total: number;
}

export function loadFirstResponder(core: LoadCore): Promise<BlockResult<FirstResponderBlock>> {
  return fromCore("quién respondió primero", core, (data) => firstResponderSlices(data.first_responder ?? []));
}

export function loadEscalationReasons(client: Db, a: ChatQueryArgs): Promise<BlockResult<EscalationReason[]>> {
  return blockResult("por qué derivó", async () => {
    const res = await chatRpc(client, "chat_dashboard_escalation_reasons", { ...common(a), p_limit: 6 });
    return fromRpc<EscalationSqlRow, EscalationReason[]>(res, escalationReasons);
  });
}

export function loadAgentActions(client: Db, a: ChatQueryArgs): Promise<BlockResult<AgentActionRow[]>> {
  return blockResult("las acciones del agente", async () => {
    const res = await chatRpc(client, "chat_dashboard_agent_actions", common(a));
    return fromRpc<{ action: string; actions: number; reverted: number }, AgentActionRow[]>(res, agentActionRows);
  });
}

export function loadRuleResults(
  client: Db,
  a: ChatQueryArgs,
  rules: Array<{ id: string; name?: string | null }>,
): Promise<BlockResult<RuleResultRow[]>> {
  return blockResult("los resultados de las reglas", async () => {
    const res = await chatRpc(client, "chat_dashboard_rule_results", common(a));
    return fromRpc<RuleResultSqlRow, RuleResultRow[]>(res, (rows) => ruleResultRows(rows, rules));
  });
}

export function loadDrafts(client: Db, a: ChatQueryArgs): Promise<BlockResult<DraftsCard>> {
  return blockResult("la aprobación de respuestas", async () => {
    const res = await chatRpc(client, "chat_dashboard_drafts", { ...common(a), p_tz: a.timezone });
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
    const res = await chatRpc(client, "chat_dashboard_team_v2", common(a));
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
      chatRpc(client, "chat_dashboard_patterns_v2", {
        p_workspace_id: a.workspaceId,
        p_direction: "outbound",
        p_from: a.range.from,
        p_to: a.range.to,
        p_channel: a.channel,
        p_author: a.author,
      }),
      chatRpc(client, "chat_dashboard_patterns_v2", {
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
    const res = await chatRpc(client, "chat_dashboard_replies", {
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
 * Usa las mismas formulas que la tarea de clasificacion (`lib/patterns/quality.ts`):
 * una precision que se calcule de dos maneras distintas termina en dos numeros
 * distintos y nadie sabe cual creer.
 */
export function loadQualityLine(client: Db, a: ChatQueryArgs): Promise<BlockResult<QualityLine>> {
  return blockResult<QualityLine>("la calidad de la clasificación", async () => {
    // Se cuenta en `message_texts` y no con `message_text_volumes`: de esa funcion
    // solo importan `source` y `review_result`, que no dependen del periodo, y
    // traer todas las filas repasaba `messages` y podia cortarse en el tope de filas.
    const count = (label: string, filter: (q: TextCountQuery) => TextCountQuery) =>
      chatQuery(label, () =>
        filter(
          client
            .from("message_texts")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", a.workspaceId),
        ) as unknown as PromiseLike<ChatQueryResult>,
      );
    const [status, reviewed, okReviewed, modelTexts, corrected] = await Promise.all([
      chatRpc(client, "message_classification_status", { p_workspace_id: a.workspaceId, p_tz: a.timezone }),
      count("calidad: revisados", (q) => q.not("review_result", "is", null)),
      count("calidad: bien clasificados", (q) => q.eq("review_result", "ok")),
      count("calidad: del modelo", (q) => q.eq("source", "model")),
      count("calidad: corregidos", (q) => q.eq("source", "model").eq("review_result", "corrected")),
    ]);
    for (const res of [status, reviewed, okReviewed, modelTexts, corrected]) {
      if (res.error) return { error: res.error.message };
    }

    const s = ((status.data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
    const reviewedCount = reviewed.count ?? 0;
    const modelCount = modelTexts.count ?? 0;

    return {
      data: {
        lastRunAt: (s.last_run_at as string | null) ?? null,
        lastRunStatus: (s.last_run_status as string | null) ?? null,
        classifiedToday: Number(s.texts_classified_today ?? 0),
        unclassifiedPending: Number(s.unclassified_pending ?? 0),
        accuracyPct: reviewedCount > 0 ? Math.round(((okReviewed.count ?? 0) / reviewedCount) * 100) : null,
        reviewedCount,
        correctedPct: modelCount > 0 ? Math.round(((corrected.count ?? 0) / modelCount) * 100) : null,
      },
    };
  });
}
