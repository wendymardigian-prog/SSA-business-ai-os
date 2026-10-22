import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { readWorkspaceSpendSettings } from "@/lib/ai/spend-settings";
import { getWorkspace } from "@/lib/workspace";
import { isOwnerRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { loadWorkspaceAgents } from "@/lib/agent/config";
import { getAgentType, tabsForViewer } from "@/lib/agent/agent-types";
import { loadAgentsPageMode } from "@/lib/agent/usage";
import { PROVIDERS } from "@/lib/integrations/providers";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { platformLabel } from "@/lib/platforms";
import { toScreenAgent, type ActionsTabData, type AgentScreenData, type RunsTabData, type TagsTabData } from "@/lib/agent/screen";
import { agentUsableTagIds } from "@/lib/tags/effects";
import { serializeSkillsForScreen, serializeToolsForScreen } from "@/lib/agent/tools/config";
import { ACTIONS_PAGE_SIZE, loadActions, parseActionFilters } from "@/lib/agent/actions-query";
import { loadCostsTab, loadHeaderKpis, parseCostFilters } from "@/lib/agent/costs-query";
import { loadRuns, RUNS_PAGE_SIZE } from "@/lib/agent/runs-query";
import { loadRunsScreenInputs } from "@/lib/agent/runs-screen-data";
import { getPermissionContext, requirePermission } from "@/lib/auth/guards";
import { loadContactStatusSettings } from "@/lib/contacts/status-settings-load";
import { activeStatuses } from "@/lib/contacts/statuses";
import { getSavedViewerTimezone, resolveViewerTimezone } from "@/lib/user-timezone";
import { AgentDetailView, AgentTabBody } from "@/components/agents/agent-detail-view";
import { TabBodySkeleton } from "@/components/agents/detail-tabs";
import type { AgentTypeDefinition } from "@/lib/agent/agent-types";

/**
 * Detalle de un agente (F24, F26, F27, F28, F30).
 *
 * Owner/Admin ven todas las pestanas. Un Member entra solo a Runs y Acciones,
 * acotadas a su scope por la RLS y sin columnas de costo: la configuracion y
 * los topes de gasto se leen con service role pero no se le mandan.
 */
export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agentId } = await params;
  const query = await searchParams;
  // Ver el agente pide `agents.view`; configurarlo, `agents.edit`; sus costos, `ai_costs.view` (Equipo y roles, F23).
  // La zona guardada de quien mira se pide junto con el permiso (no depende de el); despues `resolveViewerTimezone`
  // la toma del cache del request.
  const [permissions] = await Promise.all([requirePermission("agents.view"), getSavedViewerTimezone()]);
  const [{ workspace, supabase }, service] = await Promise.all([getWorkspace(), createServiceClient()]);
  const viewerCan = permissions.can;
  const canEdit = viewerCan("agents.edit");
  // Costos y topes: la zona del NEGOCIO (consistente con los topes que
  // evalua el agente). La pestana Acciones es un filtro: la de quien mira.
  const [viewerTimezone, agents, pageMode] = await Promise.all([
    resolveViewerTimezone(workspace.timezone),
    loadWorkspaceAgents(service, workspace.id),
    loadAgentsPageMode(service, workspace.id),
  ]);
  // Sin IA conectada y sin haberla usado nunca, Agentes IA es solo la invitacion a conectarla (lib/agent/page-mode.ts).
  if (pageMode.mode === "empty") redirect("/dashboard/agents");
  // Los proveedores van siempre (para Owner/Admin): la cabecera avisa si el del agente no esta conectado.
  const providers = canEdit ? pageMode.providers : [];
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) notFound();
  const typeDef = getAgentType(agent.type);
  if (!typeDef) notFound();

  const { tabs, defaultTab } = tabsForViewer(typeDef, viewerCan);
  const requested = typeof query.tab === "string" ? query.tab : defaultTab;
  const tab = tabs.find((t) => t.key === requested && t.available)?.key ?? defaultTab;

  // Solo lo que usa la pestana abierta. Antes cada clic en una pestana
  // traia los datos de TODAS (versiones, conocimiento, triggers, eventos,
  // miembros...) en una cadena de consultas una detras de otra. Que lee
  // cada pestana: config (versiones, modelos, precios; el copywriter ademas
  // el conocimiento), tools (etiquetas, miembros, eventos), knowledge
  // (documentos), channels (canales, triggers, etiquetas, miembros,
  // eventos), actions (canales, etiquetas, miembros), tags (etiquetas,
  // miembros). Los proveedores van siempre: la cabecera avisa si el del
  // agente no esta conectado.
  const on = (...keys: string[]) => keys.includes(tab);
  const need = {
    versions: canEdit && on("config"),
    pricing: canEdit && on("config"),
    docs: canEdit && (on("knowledge") || (on("config") && agent.type === "copywriter")),
    triggers: canEdit && on("channels"),
    channels: on("channels", "actions"),
    tags: on("tools", "channels", "actions", "tags"),
    members: on("config", "tools", "channels", "actions", "tags"),
    events: on("tools", "channels"),
  };
  const none = Promise.resolve({ data: [] as never[] });

  // Runs (D8, revertido): la pestaña ya no redirige a la pantalla global de
  // Corridas, la embebe. Mismo camino que esa pantalla (loadRunsScreenInputs
  // + loadRuns), con este agente fijo (currentAgentId): no cuenta como
  // filtro activo y el selector de Agente arranca en el.
  const loadRunsTab = async (): Promise<RunsTabData> => {
    const permissions = await getPermissionContext();
    const includeCost = permissions.can("ai_costs.view");
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (typeof v === "string") sp.set(k, v);
    const { filters, dateRange, client, agents: runAgents, channels: runChannels, options } = await loadRunsScreenInputs({
      workspaceId: workspace.id,
      timeZone: viewerTimezone,
      service,
      userClient: supabase,
      includeCost,
      searchParams: sp,
      rawParams: query,
      currentAgentId: agent.id,
    });
    const { rows, total } = await loadRuns(client, {
      workspaceId: workspace.id,
      filters,
      includeCost,
      agentNames: new Map(runAgents.map((a) => [a.id, a.name])),
      channelLabels: new Map(runChannels.map((c) => [c.id, c.label])),
      dateRange,
    });
    return { rows, total, pageSize: RUNS_PAGE_SIZE, filters, showCost: includeCost, isAdmin: canEdit, canExport: viewerCan("data.export"), options };
  };

  // Los eventos activos u ocultos, con su categoria, para la habilidad de
  // agendamiento. Un evento oculto igual sirve: se llega con el link directo.
  const loadEventTypes = async () => {
    const [{ data: events }, { data: cats }] = await Promise.all([
      supabase.from("event_types").select("id, title, status, category_id, duration_minutes").eq("workspace_id", workspace.id).is("deleted_at", null).neq("status", "inactive").order("title"),
      supabase.from("booking_categories").select("id, parent_id, name").eq("workspace_id", workspace.id),
    ]);
    const byId = new Map((cats ?? []).map((c) => [c.id, c]));
    return (events ?? []).map((e) => {
      const type = e.category_id ? byId.get(e.category_id) : undefined;
      const area = type?.parent_id ? byId.get(type.parent_id) : type;
      const label = area && type && area.id !== type.id ? `${area.name} · ${type.name}` : (area?.name ?? "");
      return { value: e.id, label: e.title, hint: [label, `${e.duration_minutes} min`].filter(Boolean).join(" · ") };
    });
  };

  const screenAgent = toScreenAgent(agent);
  if (!canEdit) {
    // Los topes de gasto no salen del servidor para un Member (00060).
    screenAgent.dailyCostLimitUsd = null;
    screenAgent.monthlyCostLimitUsd = null;
    screenAgent.systemPrompt = "";
    screenAgent.toolsConfig = {};
  }

  // Costos y los indicadores de la cabecera: solo Owner/Admin, con service
  // role. Los indicadores NO se esperan: viajan como promesa y la vista los
  // pinta cuando llegan (ver `loadHeaderKpis`).
  // Un error aca no puede tumbar la pantalla: la fila queda en "—".
  const kpis = canEdit
    ? loadHeaderKpis(service, { workspaceId: workspace.id, agentId: agent.id, timeZone: workspace.timezone }).catch((error: unknown) => {
        console.error("[agents] no pude leer los indicadores de la cabecera:", error instanceof Error ? error.message : error);
        return { runsToday: 0, monthCostUsd: null, escalationRatePct: null, missingPricing: 0 };
      })
    : undefined;

  // El contenido de la pestaña abierta: todo lo de abajo corre dentro de su `<Suspense key={tab}>`, asi el
  // encabezado y las pestañas se dibujan sin esperarlo.
  const loadTab = async (): Promise<AgentScreenData> => {
    // Solo lo usa la pestaña Herramientas.
    const setterStatusSettingsPromise = on("tools") ? loadContactStatusSettings(workspace.id) : Promise.resolve(null);
    const [versionsRes, pricingRes, channelsRes, docsRes, triggersRes, members, tagsRes, eventTypesForAgent, runs, costs, tagCountsRes, copywriterRaw] =
      await Promise.all([
        need.versions
          ? supabase
              .from("agent_prompt_versions")
              .select("version, system_prompt, note, created_at, created_by")
              .eq("agent_id", agent.id)
              .order("version", { ascending: false })
          : none,
        // model_pricing la leen Owner/Admin; con el cliente del usuario alcanza.
        need.pricing ? supabase.from("model_pricing").select("provider, model").eq("workspace_id", workspace.id) : none,
        need.channels
          ? supabase
              .from("channels")
              .select("id, platform, username, display_name, is_active")
              .eq("workspace_id", workspace.id)
              .order("created_at", { ascending: true })
          : none,
        need.docs
          ? supabase.from("knowledge_base").select("id, title, tags, internal_only, status").eq("workspace_id", workspace.id).is("deleted_at", null)
          : none,
        need.triggers
          ? supabase
              .from("triggers")
              .select("id, config, flows!inner(id, name, status, workspace_id)")
              .eq("type", "default")
              .eq("is_active", true)
              .eq("flows.status", "published")
              .eq("flows.workspace_id", workspace.id)
          : none,
        need.members ? getWorkspaceMembers(workspace.id) : Promise.resolve([]),
        need.tags
          ? supabase.from("tags").select("id, name, color, disables_agent, assigns_to").eq("workspace_id", workspace.id).order("name")
          : none,
        need.events ? loadEventTypes() : Promise.resolve([]),
        on("runs") ? loadRunsTab() : Promise.resolve(undefined),
        viewerCan("ai_costs.view") && on("costs")
          ? loadCostsTab(service, {
              workspaceId: workspace.id,
              agent,
              filters: parseCostFilters(query),
              agentNames: new Map(agents.map((a) => [a.id, a.name])),
              workspaceSettings: readWorkspaceSpendSettings(workspace),
              canEditPricing: isOwnerRole(permissions.role),
              timeZone: workspace.timezone,
            })
          : Promise.resolve(undefined),
        canEdit && on("tags") ? supabase.from("tags").select("id, contact_tags(count)").eq("workspace_id", workspace.id) : Promise.resolve(undefined),
        // Lo propio del copywriter: su configuracion no encaja en la del agente
        // de conversacion, asi que viaja aparte (E3).
        agent.type === "copywriter" && on("config")
          ? Promise.all([
              supabase.from("agents").select("config").eq("id", agent.id).maybeSingle(),
              supabase.from("workspaces").select("content_copy_settings").eq("id", workspace.id).maybeSingle(),
            ])
          : Promise.resolve(undefined),
      ]);
    const allTags = tagsRes.data ?? [];
    // La lista blanca del agente nunca ofrece una etiqueta con efecto (00073).
    const usableTagIds = agentUsableTagIds(allTags.map((t) => ({ id: t.id, disablesAgent: t.disables_agent, assignsTo: t.assigns_to })));

    const memberNames = new Map(members.map((m) => [m.userId, m.name]));
    const flowsCapturingAll = new Map<string, string>();
    for (const row of (triggersRes.data ?? []) as Array<{ config: unknown; flows: { id: string; name: string } | { id: string; name: string }[] }>) {
      const config = (row.config ?? {}) as Record<string, unknown>;
      if (config.only_if_agent_off === true) continue;
      const flow = Array.isArray(row.flows) ? row.flows[0] : row.flows;
      if (flow) flowsCapturingAll.set(flow.id, flow.name);
    }

    const channels = ((channelsRes.data ?? []) as Array<{ id: string; platform: string; username: string | null; display_name: string | null; is_active: boolean }>).map((c) => ({
      id: c.id,
      platform: c.platform,
      label: platformLabel(c.platform),
      handle: c.username ? `@${c.username}` : c.display_name ?? null,
      isActive: c.is_active,
      takenBy: agents.find((a) => a.id !== agent.id && a.enabledChannelIds.includes(c.id))?.name ?? null,
    }));
    const pricedModels = ((pricingRes.data ?? []) as Array<{ provider: string; model: string }>).map((p) => `${p.provider}/${p.model}`);

    // Acciones: necesita los canales, las etiquetas y los miembros de arriba
    // para traducir ids a nombres, asi que va despues.
    let actions: ActionsTabData | undefined;
    if (tab === "actions") {
      const channelLabel = (c: (typeof channels)[number]) => (c.handle ? `${c.label} ${c.handle}` : c.label);
      const filters = parseActionFilters(query, {
        currentAgentId: agent.id,
        agentIds: agents.map((a) => a.id),
        channelIds: channels.map((c) => c.id),
      });
      // Siempre con el cliente del usuario: la policy de la 00068 acota a un
      // Member a las acciones sobre sus leads; un Admin ve todas.
      const [{ rows, total }, anyRes] = await Promise.all([
        loadActions(supabase, {
          workspaceId: workspace.id,
          filters,
          agentNames: new Map(agents.map((a) => [a.id, a.name])),
          channelLabels: new Map(channels.map((c) => [c.id, channelLabel(c)])),
          tagNames: new Map(allTags.map((t) => [t.id, t.name])),
          memberNames,
          timeZone: viewerTimezone,
        }),
        supabase.from("audit_log").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).not("performed_by_agent_id", "is", null),
      ]);
      actions = {
        filters,
        rows,
        total,
        pageSize: ACTIONS_PAGE_SIZE,
        anyActions: (anyRes.count ?? 0) > 0,
        options: { agents: agents.map((a) => ({ id: a.id, name: a.name })), channels: channels.map((c) => ({ id: c.id, label: channelLabel(c) })) },
      };
    }

    // Etiquetas (Bloque 2d-A): el efecto de cada una sobre el agente.
    let tags: TagsTabData | undefined;
    if (tagCountsRes) {
      if (tagCountsRes.error) console.error("[agents] no pude contar los contactos por etiqueta:", tagCountsRes.error.message);
      const countOf = new Map(
        ((tagCountsRes.data ?? []) as Array<{ id: string; contact_tags: Array<{ count: number }> | null }>).map((t) => [t.id, t.contact_tags?.[0]?.count ?? 0]),
      );
      tags = {
        tags: allTags.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          disablesAgent: t.disables_agent,
          assignsTo: t.assigns_to,
          contactCount: countOf.get(t.id) ?? 0,
        })),
        members: members.map((m) => ({ userId: m.userId, label: m.name })),
      };
    }

    const copywriter = copywriterRaw
      ? (() => {
          const [{ data: raw }, { data: ws }] = copywriterRaw;
          const docTags = new Set<string>();
          for (const doc of (docsRes.data ?? []) as Array<{ tags?: string[] | null }>) {
            for (const tag of doc.tags ?? []) docTags.add(tag);
          }
          return {
            config: raw?.config ?? {},
            workspaceSettings: ws?.content_copy_settings ?? null,
            availableTags: [...docTags].sort(),
          };
        })()
      : undefined;

    const setterStatusSettings = await setterStatusSettingsPromise;
    const data: AgentScreenData = {
      viewer: { isAdmin: canEdit, permissionKeys: permissions.permissions.keys },
      copywriter,
      costs,
      actions,
      runs,
      tags,
      agent: screenAgent,
      tools: serializeToolsForScreen(),
      skills: serializeSkillsForScreen(),
      toolOptionSources: {
        tags: allTags.filter((t) => usableTagIds.has(t.id)).map((t) => ({ value: t.id, label: t.name })),
        members: members.map((m) => ({ value: m.userId, label: m.name, hint: m.role })),
        contact_fields: [],
        // Los eventos que el agente puede ofrecer (Etapa 4, F52). Los inactivos
        // no entran: ofrecer un evento apagado da un link que no agenda.
        event_types: eventTypesForAgent,
        // Pipeline (00245): los estados de setter activos (Ajustes → Estados).
        setter_statuses: setterStatusSettings ? activeStatuses(setterStatusSettings.setter).map((st) => ({ value: st.key, label: st.name })) : [],
      },
      versions: ((versionsRes.data ?? []) as Array<{ version: number; system_prompt: string; note: string | null; created_at: string; created_by: string | null }>).map((v) => ({
        version: v.version,
        systemPrompt: v.system_prompt,
        note: v.note,
        createdAt: v.created_at,
        authorLabel: v.created_by ? memberNames.get(v.created_by) ?? null : null,
      })),
      providers,
      providerLabels: PROVIDER_LABELS,
      pricedModels,
      channels,
      knowledgeDocs: ((docsRes.data ?? []) as Array<{ id: string; title: string; tags: string[] | null; internal_only: boolean | null; status: string }>).map((d) => ({
        id: d.id,
        title: d.title,
        tags: d.tags ?? [],
        internalOnly: Boolean(d.internal_only),
        status: d.status,
      })),
      flowsCapturingAll: [...flowsCapturingAll].map(([id, name]) => ({ id, name })),
    };

    return data;
  };

  return (
    <AgentDetailView
      header={{ viewer: { isAdmin: canEdit, permissionKeys: permissions.permissions.keys }, kpis, agent: screenAgent, providers, providerLabels: PROVIDER_LABELS }}
      typeDef={typeDef}
      tab={tab}
      timeZone={viewerTimezone}
    >
      <Suspense key={tab} fallback={<TabBodySkeleton />}>
        <AgentTab load={loadTab} typeDef={typeDef} tab={tab} />
      </Suspense>
    </AgentDetailView>
  );
}

const PROVIDER_LABELS = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.label]));

/** El contenido de la pestaña: espera solo sus datos, dentro de su `<Suspense>`. */
async function AgentTab({ load, typeDef, tab }: { load: () => Promise<AgentScreenData>; typeDef: AgentTypeDefinition; tab: string }) {
  return <AgentTabBody data={await load()} typeDef={typeDef} tab={tab} />;
}
