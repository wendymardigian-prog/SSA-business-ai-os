/**
 * Un solo registro de los bloques del dashboard de Chat.
 *
 * Lo usan la pagina (los de arriba, en streaming) y la ruta
 * `/api/v1/dashboards/chat/block` (los que se piden al llegar con el scroll y el
 * "Reintentar" de un bloque). Asi los dos caminos cargan lo mismo y comparten la
 * misma cache.
 *
 * Lo que algunos bloques necesitan aparte (el equipo, los nombres de las reglas)
 * se pide solo si ese bloque se carga: pedir un bloque no arrastra a los demas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { PermissionContext } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/auth/roles";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { getAgentType } from "@/lib/agent/agent-types";
import { AGENT_PUBLIC_COLUMNS, type PublicAgent } from "@/lib/agent/public";
import { validateRules } from "@/lib/agent/rules/schema";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import type { DashboardFilters } from "@/lib/dashboards/url-state";
import { chatBlockCache, chatBlockCacheKey } from "./block-cache";
import { UNCACHED_BLOCKS, type ChatBlockData, type ChatBlockKey } from "./block-keys";
import { minStoredAtFor, type ChatGenerations } from "./generation";
import {
  chatQueryArgs,
  loadAgent,
  loadAgentActions,
  loadCards,
  loadDrafts,
  loadEscalationReasons,
  loadFirstResponder,
  loadPatterns,
  loadQualityLine,
  loadRuleResults,
  loadTeam,
  loadTrends,
  type ChatQueryArgs,
} from "./loaders";
import { fail } from "./result";
import type { BlockResult } from "./types";

type Db = SupabaseClient<Database>;

export interface ChatTeamMember {
  id: string;
  label: string;
  role: string;
}

export interface ChatRuleName {
  id: string;
  name?: string | null;
}

export interface ChatBlockContext {
  client: Db;
  args: ChatQueryArgs;
  userId: string;
  generations: ChatGenerations;
  /** Saltear lo guardado: "Reintentar" tiene que volver a preguntar. */
  skipStored?: boolean;
  members: () => Promise<ChatTeamMember[]>;
  rules: () => Promise<ChatRuleName[]>;
}

type Loaders = { [K in ChatBlockKey]: (ctx: ChatBlockContext) => Promise<BlockResult<ChatBlockData[K]>> };

/** Los datos aparte de un bloque pueden fallar: no pueden tumbar la promesa que lee `use()`. */
async function withExtra<E, T>(
  label: string,
  extra: () => Promise<E>,
  load: (value: E) => Promise<BlockResult<T>>,
): Promise<BlockResult<T>> {
  let value: E;
  try {
    value = await extra();
  } catch (err) {
    console.error(`[dashboard-chat] ${label}:`, err instanceof Error ? err.message : "error inesperado");
    return fail("No pudimos traer los datos. Probá de nuevo en unos segundos.");
  }
  return load(value);
}

const LOADERS: Loaders = {
  cards: (c) => loadCards(c.client, c.args),
  trends: (c) => loadTrends(c.client, c.args),
  agent: (c) => loadAgent(c.client, c.args),
  firstResponder: (c) => loadFirstResponder(c.client, c.args),
  escalations: (c) => loadEscalationReasons(c.client, c.args),
  actions: (c) => loadAgentActions(c.client, c.args),
  rules: (c) => withExtra("reglas", c.rules, (rules) => loadRuleResults(c.client, c.args, rules)),
  drafts: (c) => loadDrafts(c.client, c.args),
  team: (c) => withExtra("equipo", c.members, (members) => loadTeam(c.client, c.args, members, c.userId)),
  patterns: (c) => loadPatterns(c.client, c.args),
  quality: (c) => loadQualityLine(c.client, c.args),
};

/** Carga un bloque, por la cache salvo los que no se guardan. Nunca rechaza. */
export function loadChatBlock<K extends ChatBlockKey>(key: K, ctx: ChatBlockContext): Promise<BlockResult<ChatBlockData[K]>> {
  const load = () => LOADERS[key](ctx);
  if (UNCACHED_BLOCKS.includes(key)) return load();
  return chatBlockCache().get<ChatBlockData[K]>(
    chatBlockCacheKey({
      userId: ctx.userId,
      workspaceId: ctx.args.workspaceId,
      block: key,
      channel: ctx.args.channel,
      author: ctx.args.author,
      rangeFrom: ctx.args.range.from,
      rangeTo: ctx.args.range.to,
      timezone: ctx.args.timezone,
    }),
    load,
    { minStoredAt: minStoredAtFor(key, ctx.generations), skipStored: ctx.skipStored },
  );
}

/**
 * Los nombres de las reglas, para que la tarjeta diga "Regla 3 · menciona precio" y
 * nunca el id. Columna explicita: `response_rules` esta concedida a authenticated
 * (00077), los topes de gasto no.
 */
export async function loadRuleNames(client: Db, agentId: string): Promise<ChatRuleName[]> {
  const { data, error } = await client.from("agents").select("response_rules").eq("id", agentId).maybeSingle();
  if (error) throw new Error(error.message);
  const parsed = validateRules((data as { response_rules?: unknown } | null)?.response_rules);
  // Una lista invalida en la base no rompe la pantalla: la tarjeta muestra los
  // turnos por numero de regla y se sigue.
  return parsed.ok ? (parsed.rules ?? []).map((r) => ({ id: r.id, name: r.name ?? null })) : [];
}

/** El contexto de un bloque suelto, armado desde la sesion (la ruta). */
export async function chatBlockContextFromSession(
  session: PermissionContext,
  filters: DashboardFilters,
  generations: ChatGenerations,
  skipStored: boolean,
): Promise<ChatBlockContext> {
  const { workspace, user, role, supabase } = session;
  const timezone = await resolveViewerTimezone((workspace as { timezone?: string }).timezone);
  return {
    client: supabase,
    args: chatQueryArgs({ workspaceId: workspace.id, filters, timezone }),
    userId: user.id,
    generations,
    skipStored,
    members: async () =>
      isAdminRole(role)
        ? (await getWorkspaceMembers(workspace.id)).map((m) => ({ id: m.userId, label: m.name, role: m.role }))
        : [],
    rules: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select(AGENT_PUBLIC_COLUMNS)
        .eq("workspace_id", workspace.id)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
      const agent = ((data ?? []) as unknown as PublicAgent[]).find((a) => getAgentType(a.type)?.conversational);
      return agent ? loadRuleNames(supabase, agent.id) : [];
    },
  };
}
