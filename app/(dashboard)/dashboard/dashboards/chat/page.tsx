import { getWorkspace } from "@/lib/workspace";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { parseDashboardFilters } from "@/lib/dashboards/url-state";
import { getPermissionContext, requirePermission } from "@/lib/auth/guards";
import { availableDashboards, comingSoonDashboards } from "@/lib/dashboards/available";
import { isAdminRole } from "@/lib/auth/roles";
import { platformLabel } from "@/lib/platforms";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { chatAgentEverActed } from "@/lib/agent/usage";
import { createServiceClient } from "@/lib/supabase/server";
import { agentSectionVisibility } from "@/lib/dashboards/chat/agent-visibility";
import { AGENT_PUBLIC_COLUMNS, publicChannelMode, type PublicAgent } from "@/lib/agent/public";
import { getAgentType } from "@/lib/agent/agent-types";
import { validateRules } from "@/lib/agent/rules/schema";
import { draftChannelLabels, draftChannels } from "@/lib/dashboards/chat/channel-modes";
import { chatQueryArgs, loadAgent, loadAgentActions, loadCards, loadDrafts, loadEscalationReasons, loadFirstResponder, loadPatterns, loadQualityLine, loadRuleResults, loadTeam, loadTrends } from "@/lib/dashboards/chat/loaders";
import { countPendingDrafts } from "@/lib/actions/agent-drafts";
import { draftsQueueHref } from "@/lib/agent/drafts/destination";
import { ChatDashboardShell } from "@/components/dashboards/chat/chat-dashboard-shell";
import { resolveViewerTimezone } from "@/lib/user-timezone";

export const dynamic = "force-dynamic";

/**
 * Dashboard de Chat (Bloques 2e y 3, F14-F18, F22).
 *
 * Todo se calcula con funciones SQL SECURITY INVOKER: se llaman con el cliente
 * del usuario, asi la RLS aplica el scope de leads sin lógica extra acá. Un
 * Member ve solo sus conversaciones; Owner y Admin, todo el workspace.
 *
 * **Las consultas de los bloques NO se esperan acá**: se crean las promesas y se
 * pasan al componente, que muestra cada bloque cuando llega el suyo. Lo único
 * que se espera es el armazón (workspace, canales, equipo, agentes), que es
 * rápido y decide qué bloques existen.
 */
export default async function ChatDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Equipo y roles: la pagina pide su permiso.
  await requirePermission("dashboards.chat.view");
  const { workspace, user, role, supabase } = await getWorkspace();
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") params.set(k, v);

  const filters = parseDashboardFilters(params);
  const timezone = await resolveViewerTimezone((workspace as { timezone?: string }).timezone);
  const isAdmin = isAdminRole(role);

  const service = await createServiceClient();
  const [permissions, members, channelsRes, agentsRes, draftCounts, aiProviders, everActed] = await Promise.all([
    getPermissionContext(),
    isAdmin ? getWorkspaceMembers(workspace.id) : Promise.resolve([]),
    supabase.from("channels").select("id, platform, display_name, username, is_active").eq("workspace_id", workspace.id),
    supabase.from("agents").select(AGENT_PUBLIC_COLUMNS).eq("workspace_id", workspace.id).is("deleted_at", null),
    countPendingDrafts(),
    // Las IAs conectadas: deciden si la seccion del agente se muestra (O).
    listConnectedAiProviders(workspace.id),
    // Si el agente actuo alguna vez: sin historia y sin un agente andando, la seccion no existe.
    chatAgentEverActed(service, workspace.id),
  ]);

  const channels = (
    (channelsRes.data as Array<{ id: string; platform: string; display_name: string | null; username: string | null; is_active: boolean }> | null) ?? []
  ).map((c) => ({
    id: c.id,
    label: c.display_name ?? (c.username ? `${platformLabel(c.platform)} · @${c.username}` : platformLabel(c.platform)),
    platform: c.platform,
    connected: c.is_active,
  }));

  const agents = ((agentsRes.data ?? []) as PublicAgent[]).filter((a) => getAgentType(a.type)?.conversational);
  const agent = agents[0] ?? null;
  const drafts = draftChannels(agents);
  // Cuando se muestra "El agente" (O): si nunca actuo y no hay uno andando, ni se dibuja ni se consultan sus datos.
  const agentVisibility = agentSectionVisibility({
    agents: agents.map((a) => ({
      isEnabled: a.is_enabled,
      provider: a.provider ?? null,
      model: a.model ?? null,
      channelCount: (a.enabled_channel_ids ?? []).length,
    })),
    connectedProviders: aiProviders.map((p) => p.provider),
    everActed,
  });
  const showAgentSection = agentVisibility.mode === "full" || agentVisibility.mode === "full-with-warning";

  // Los resultados de reglas solo existen si algún canal decide por reglas.
  const anyRulesChannel = showAgentSection && agents.some((a) =>
    (a.enabled_channel_ids ?? []).some((id) => publicChannelMode(a, id) === "rules"),
  );
  // Los nombres de las reglas, para que la tarjeta diga "Regla 3 · menciona
  // precio" y nunca el id (§16). Columna explícita: `response_rules` está
  // concedida a authenticated (00077), los topes de gasto no.
  let rules: Array<{ id: string; name?: string | null }> = [];
  if (anyRulesChannel && agent) {
    const { data } = await supabase.from("agents").select("response_rules").eq("id", agent.id).maybeSingle();
    const parsed = validateRules((data as { response_rules?: unknown } | null)?.response_rules);
    // Una lista invalida en la base no rompe la pantalla: la tarjeta muestra los
    // turnos por numero de regla y se sigue.
    if (parsed.ok) rules = (parsed.rules ?? []).map((r) => ({ id: r.id, name: r.name ?? null }));
  }

  const args = chatQueryArgs({ workspaceId: workspace.id, filters, timezone });

  // Una promesa por bloque, sin await: la pantalla no espera a la más lenta.
  const blocks = {
    cards: loadCards(supabase, args),
    trends: loadTrends(supabase, args),
    agentSection: showAgentSection
      ? {
          agent: loadAgent(supabase, args),
          firstResponder: loadFirstResponder(supabase, args),
          escalations: loadEscalationReasons(supabase, args),
          actions: loadAgentActions(supabase, args),
          rules: anyRulesChannel ? loadRuleResults(supabase, args, rules) : null,
        }
      : null,
    drafts: loadDrafts(supabase, args),
    team: loadTeam(
      supabase,
      args,
      members.map((m) => ({ id: m.userId, label: m.name, role: m.role })),
      user.id,
    ),
    patterns: loadPatterns(supabase, args),
    quality: loadQualityLine(supabase, args),
  };

  return (
    <ChatDashboardShell
      blocks={blocks}
      filters={filters}
      channels={channels}
      members={members.map((m) => ({ id: m.userId, label: m.name, role: m.role }))}
      dashboards={availableDashboards(permissions.can)}
      comingSoon={comingSoonDashboards(permissions.can)}
      isAdmin={isAdmin}
      timezone={timezone}
      hasDraftChannels={drafts.hasAny}
      draftChannelsLabel={draftChannelLabels(drafts, channels)}
      draftsHref={draftsQueueHref(draftCounts)}
      agentVisibility={agentVisibility}
      agentHref={agent ? `/dashboard/agents/runs?agente=${agent.id}` : null}
      agentActionsHref={agent ? `/dashboard/agents/${agent.id}?tab=actions` : null}
    />
  );
}
