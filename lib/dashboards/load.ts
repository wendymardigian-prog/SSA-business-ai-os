import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { resolvePeriod, previousPeriod, type PeriodPreset } from "./period";
import type { DashboardFilters } from "./url-state";

type Db = SupabaseClient<Database>;

export interface DashboardNumbers {
  newConversations: number;
  messagesIn: number;
  messagesOut: number;
  firstResponseMedianSeconds: number | null;
}

export interface ChatDashboardData {
  range: { from: string | null; to: string | null };
  numbers: DashboardNumbers;
  previous: DashboardNumbers | null;
  waitingNow: number;
  agent: { newConversations: number; acted: number; tookFirst: number; escalated: number };
  team: Array<{ author: string; messagesOut: number; firstResponseMedianSeconds: number | null; replyMedianSeconds: number | null; repliesUnder1hPct: number | null }>;
  trends: Array<{ day: string; messagesIn: number; messagesOut: number; newConversations: number }>;
}

function num(row: Record<string, unknown> | undefined): DashboardNumbers {
  return {
    newConversations: Number(row?.new_conversations ?? 0),
    messagesIn: Number(row?.messages_in ?? 0),
    messagesOut: Number(row?.messages_out ?? 0),
    firstResponseMedianSeconds: row?.first_response_median_seconds != null ? Number(row.first_response_median_seconds) : null,
  };
}

/**
 * Carga todo el dashboard de Chat con las funciones SQL (F15). Se llama con el
 * cliente del usuario: la RLS aplica el scope de leads. El período anterior se
 * pide con otro rango de igual duración.
 */
export async function loadChatDashboard(
  client: Db,
  args: { workspaceId: string; filters: DashboardFilters; timezone: string; now?: Date },
): Promise<ChatDashboardData> {
  const now = args.now ?? new Date();
  const range = args.filters.from && args.filters.to
    ? { from: args.filters.from, to: args.filters.to }
    : resolvePeriod(args.filters.period as PeriodPreset, now, args.timezone);
  const prev = previousPeriod(range, now);
  const channel = args.filters.channel;
  const author = args.filters.author;

  const common = { p_workspace_id: args.workspaceId, p_channel: channel, p_from: range.from, p_to: range.to };
  const [numbersRes, prevRes, waitingRes, agentRes, teamRes, trendsRes] = await Promise.all([
    client.rpc("chat_dashboard_numbers", { ...common, p_author: author }),
    prev.from ? client.rpc("chat_dashboard_numbers", { p_workspace_id: args.workspaceId, p_channel: channel, p_from: prev.from, p_to: prev.to, p_author: author }) : Promise.resolve({ data: null }),
    client.rpc("chat_waiting_now", { p_workspace_id: args.workspaceId, p_channel: channel }),
    client.rpc("chat_dashboard_agent", common),
    client.rpc("chat_dashboard_team", common),
    client.rpc("chat_dashboard_trends", { ...common, p_author: author, p_tz: args.timezone }),
  ]);

  const agentRow = (agentRes.data as Record<string, unknown>[] | null)?.[0];
  return {
    range,
    numbers: num((numbersRes.data as Record<string, unknown>[] | null)?.[0]),
    previous: prev.from ? num((prevRes.data as Record<string, unknown>[] | null)?.[0]) : null,
    waitingNow: Number((waitingRes.data as number | null) ?? 0),
    agent: {
      newConversations: Number(agentRow?.new_conversations ?? 0),
      acted: Number(agentRow?.agent_acted ?? 0),
      tookFirst: Number(agentRow?.agent_took_first ?? 0),
      escalated: Number(agentRow?.agent_escalated ?? 0),
    },
    team: ((teamRes.data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      author: String(r.author),
      messagesOut: Number(r.messages_out ?? 0),
      firstResponseMedianSeconds: r.first_response_median_seconds != null ? Number(r.first_response_median_seconds) : null,
      replyMedianSeconds: r.reply_median_seconds != null ? Number(r.reply_median_seconds) : null,
      repliesUnder1hPct: r.replies_under_1h_pct != null ? Number(r.replies_under_1h_pct) : null,
    })),
    trends: ((trendsRes.data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      day: String(r.day),
      messagesIn: Number(r.messages_in ?? 0),
      messagesOut: Number(r.messages_out ?? 0),
      newConversations: Number(r.new_conversations ?? 0),
    })),
  };
}
