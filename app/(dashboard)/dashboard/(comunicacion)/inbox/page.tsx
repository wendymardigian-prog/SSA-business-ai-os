import { getWorkspace } from "@/lib/workspace";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { isAdminRole } from "@/lib/auth/roles";
import { platformLabel, type Platform } from "@/lib/platforms";
import { firstParam } from "@/lib/url-params";
import { resolveDateRange } from "@/lib/dates";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { SILENT_OUTREACH_FIELD, statusForQuery } from "@/lib/inbox/filters";
import { inboxListContext, listQueryOf, parseInboxListParams } from "@/lib/inbox/list-params";
import { loadDraftConversationIds, loadInboxChunk, toRows, type InboxChunk } from "@/lib/inbox/list-load";
import { InboxView } from "./inbox-view";
import { communityOptions, groupsCanMatch } from "@/lib/inbox/unified-list";
import { loadInboxGroups, loadSelectedGroup } from "@/lib/whatsapp-groups/inbox-data";
import type { InboxAsset } from "@/components/inbox/message-thread";
import { toBankAsset } from "@/lib/response-assets/list";
import { getPermissionContext } from "@/lib/auth/guards";
import { canViewChannel, channelFilterFor, replyFilterFor } from "@/lib/inbox/channel-access";
import { accountsInfo, buildAccounts, multiAccountPlatforms } from "@/lib/inbox/accounts";
import { AGENT_PUBLIC_COLUMNS, channelAgentInfo, type ChannelAgentInfo, type PublicAgent } from "@/lib/agent/public";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import type { ConversationRow } from "@/lib/inbox/types";
import { countPendingDrafts } from "@/lib/actions/agent-drafts";
import { PageHeader } from "@/components/page-header";
import { SectionTabs } from "@/components/comunicacion/section-tabs";

/**
 * Bandeja de conversaciones (F16).
 *
 * Antes traia 50 conversaciones y filtraba en memoria por estado y por texto.
 * Ahora el filtro se resuelve en la base, por los mismos motivos que la lista
 * de contactos del Bloque 3:
 *
 * 1. Filtrar en el cliente sobre una tanda arbitraria muestra resultados
 *    incompletos sin avisar: si el lead que se busca esta en la conversacion
 *    numero 60, no aparece y nada lo dice.
 * 2. El scope de leads hace que "todas las conversaciones" sea distinto para
 *    cada persona, asi que la tanda tampoco es la misma.
 * 3. Los filtros viven en la URL, asi que una vista filtrada se puede compartir
 *    o dejar en favoritos. Eso solo tiene sentido si el servidor los aplica.
 *
 * La conversacion abierta tambien va en la URL (?c=). Ademas de sobrevivir a un
 * refresh, es lo que permite saltar desde la ficha del contacto directo al hilo.
 */

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { workspace, supabase, user, role } = await getWorkspace();

  // Lo que necesitan los filtros para poder validar lo que viene de la URL:
  // un tag o un miembro inventado tiene que ignorarse, no llegar a la consulta.
  const [tagsRes, channelsRes, members, agentsRes, aiProviders, groupsCount, communityRows] = await Promise.all([
    supabase.from("tags").select("id, name, color, disables_agent, assigns_to").eq("workspace_id", workspace.id).order("name"),
    supabase.from("channels").select("id, platform, provider, username, display_name").eq("workspace_id", workspace.id).eq("is_active", true),
    getWorkspaceMembers(workspace.id),
    // Columnas explicitas: los topes de gasto no son legibles para el usuario (00060).
    supabase.from("agents").select(AGENT_PUBLIC_COLUMNS).eq("workspace_id", workspace.id).is("deleted_at", null),
    // Las IAs conectadas (E1): un agente encendido cuya IA no esta conectada no puede responder.
    listConnectedAiProviders(workspace.id),
    // ¿Hay grupos de WhatsApp para ver? (00280) Solo para ofrecer el filtro de chats o grupos; la RLS cuenta los que ve.
    supabase.from("whatsapp_groups").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("in_inbox", true).is("left_at", null),
    // Las comunidades de WhatsApp de esos grupos (00344), para el filtro por comunidad.
    supabase
      .from("whatsapp_groups")
      .select("parent_group_jid, community_subject")
      .eq("workspace_id", workspace.id)
      .eq("in_inbox", true)
      .is("left_at", null)
      .not("parent_group_jid", "is", null)
      .limit(500),
  ]);
  const communities = communityOptions(communityRows.data ?? []);

  // Por canal, si el agente lo atiende: decide si el toggle se puede operar.
  const agents = (agentsRes.data ?? []) as PublicAgent[];
  const connectedAi = aiProviders.map((p) => p.provider);
  const agentByChannel: Record<string, ChannelAgentInfo> = Object.fromEntries(
    (channelsRes.data ?? []).map((c) => [c.id, channelAgentInfo(agents, { id: c.id, label: platformLabel(c.platform) }, connectedAi)]),
  );
  // Si el canal de la conversacion abierta acepta media (lib/channels/media.ts):
  // el picker de la bandeja no le ofrece audios a un canal de email.
  const providerByChannel: Record<string, string> = Object.fromEntries(
    (channelsRes.data ?? []).map((c) => [c.id, c.provider]),
  );

  const tags = (tagsRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    disablesAgent: t.disables_agent,
    assignsTo: t.assigns_to,
  }));
  const allPlatforms = [...new Set((channelsRes.data ?? []).map((c) => c.platform))].sort() as Platform[];
  // La bandeja por cuenta (00249): cada rol dice que cuentas ve. Cuales conversaciones de cada una
  // (asignadas, + sin asignar, todas) lo aplica la RLS (`can_see_conversation`).
  const access = await getPermissionContext();
  const channelRestriction = channelFilterFor(access.permissions);
  const visibleChannelRows = (channelsRes.data ?? []).filter((c) => canViewChannel(access.permissions, c.id));
  const platformOptions = channelRestriction
    ? ([...new Set(visibleChannelRows.map((c) => c.platform))].sort() as Platform[])
    : allPlatforms;
  // Cada cuenta conectada es una opcion del menu de Canal; solo las que puede ver.
  const accounts = buildAccounts(visibleChannelRows);
  const accountInfo = accountsInfo(accounts);

  // Los filtros de la URL, validados contra lo que existe (lib/inbox/list-params.ts): la misma
  // lectura que usan «cargar mas» y el tiempo real (lib/actions/inbox-list.ts).
  const listCtx = inboxListContext({
    channels: channelsRes.data ?? [],
    tagIds: tags.map((t) => t.id),
    memberIds: members.map((m) => m.userId),
    permissions: access.permissions,
  });
  const { filters, onlyGroups } = parseInboxListParams(params, listCtx);
  const listQuery = listQueryOf(params);
  const selectedId = firstParam(params.c);
  const selectedGroupId = firstParam(params.g);

  const viewerTimezone = await resolveViewerTimezone(workspace.timezone);
  const range = resolveDateRange(filters.datePreset, filters.dateFrom, filters.dateTo, new Date(), viewerTimezone);
  const listInput = { workspaceId: workspace.id, userId: user.id, filters, range, channelRestriction };

  // Cuantas quedaron afuera: sin este numero, la lista baja de golpe y parece que se perdieron
  // chats. Mismo estado y mismas cuentas que la lista. La columna va primero: usa el indice parcial.
  const statusValue = statusForQuery(filters.status);
  let hiddenQuery = supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .is("contact_wrote_at", null)
    .filter(SILENT_OUTREACH_FIELD, "eq", true);
  if (statusValue) hiddenQuery = hiddenQuery.eq("status", statusValue);
  if (channelRestriction) {
    hiddenQuery = hiddenQuery.in("channel_id", channelRestriction.length > 0 ? channelRestriction : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (filters.platforms.length > 0) hiddenQuery = hiddenQuery.in("platform", filters.platforms as Platform[]);
  if (filters.channelIds.length > 0) hiddenQuery = hiddenQuery.in("channel_id", filters.channelIds);

  const [chunk, assetsRes, permissionCtx, draftCounts, hiddenRes, allGroups, openGroup] = await Promise.all([
    // La primera tanda (scroll infinito): las siguientes las pide la lista con un cursor
    // (lib/inbox/list-cursor.ts). Solo grupos: no se le pregunta nada a la base.
    onlyGroups
      ? Promise.resolve(EMPTY_CHUNK)
      : loadInboxChunk(supabase, listInput, { cursor: null, withCount: true }),
    // La banca de recursos del widget del composer (los seis tipos). Cualquier
    // miembro la lee. Sin URLs firmadas: las miniaturas cargan lazy y los
    // reproductores firman al apretar play. Los mas usados primero.
    supabase
      .from("response_assets")
      .select(
        "id, kind, name, shortcut, description, tags, content, url, link_kind, caption, storage_path, preview_path, mime_type, size_bytes, duration_seconds, transcript, transcript_status, transcript_error, agent_enabled, is_active, usage_count, last_used_at, created_at",
      )
      .eq("workspace_id", workspace.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("usage_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    getPermissionContext(),
    // Bloque 2d: el valor inicial de la pestana "Borradores (N)". Despues lo
    // mantiene al dia Realtime (useDraftCounts).
    countPendingDrafts(),
    hiddenQuery,
    // Todos los grupos que cumplen los filtros: la lista los intercala por fecha a medida que se baja.
    groupsCanMatch(filters) ? loadInboxGroups(supabase, workspace.id, channelsRes.data ?? [], filters, range) : Promise.resolve([]),
    selectedGroupId
      ? loadSelectedGroup(supabase, workspace.id, selectedGroupId, channelsRes.data ?? [], { isAdmin: isAdminRole(role), permissions: access.permissions })
      : Promise.resolve(null),
  ]);

  if (chunk.error) {
    console.error("[inbox] listado fallido:", chunk.error);
  }
  if (assetsRes.error) {
    console.error("[inbox] banca de recursos fallida:", assetsRes.error.message);
  }
  if (hiddenRes.error) {
    console.error("[inbox] no pude contar los chats sin identificar:", hiddenRes.error.message);
  }

  const assets: InboxAsset[] = (assetsRes.data ?? []).map(toBankAsset);
  const canManageAssets = permissionCtx.can("templates.manage");
  // Crear una tarea sobre la conversacion (Tareas, F20): con `tasks.edit`.  @plantilla-quitar(tareas)
  const canCreateTask = permissionCtx.can("tasks.edit"); // @plantilla-quitar(tareas)
  const canViewAgentRuns = permissionCtx.can("agents.view");
  // El responsable de cada conversación (00255): con `contacts.assign` se cambia; sin la clave, solo "Tomar".
  const canAssignConversations = permissionCtx.can("contacts.assign");
  // Configurar un grupo de WhatsApp desde la bandeja (00344) es cosa de quien administra los canales.
  const canManageGroups = permissionCtx.can("channels.manage");
  if (openGroup && !canManageGroups) openGroup.group.manage = null;

  const conversations = chunk.rows;

  // La conversacion abierta se trae aparte y sin filtros: un link compartido
  // tiene que abrir ese hilo aunque no entre en la pagina que se este viendo.
  let selected: ConversationRow | null =
    conversations.find((c) => c.id === selectedId) ?? null;

  if (selectedId && !selected) {
    const { data } = await supabase
      .from("conversations")
      .select(
        "*, contacts(id, display_name, avatar_url, do_not_contact, do_not_contact_reason, setter_id, vendedor_id, last_interaction_at, is_known, known_marked_by, is_customer, customer_marked_by, customer_source)",
      )
      .eq("id", selectedId)
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .maybeSingle();
    selected = toRows(data ? [data] : [])[0] ?? null;
    // Un link a una conversacion de una cuenta que no puede ver no la abre (la RLS ya la corta; esta es
    // la misma regla del lado de la pantalla).
    if (selected && !canViewChannel(access.permissions, selected.channel_id)) selected = null;
  }

  // Las conversaciones de esta pagina con un borrador del agente esperando
  // (Bloque 2d): llevan un chip para entrar directo al hilo. La RLS de
  // agent_drafts acota a un Member a sus leads.
  const draftConversationIds = await loadDraftConversationIds(supabase, [
    ...conversations.map((c) => c.id),
    ...(selected && !conversations.some((c) => c.id === selected!.id) ? [selected.id] : []),
  ]);

  const platformItems = platformOptions.map((p) => ({ value: p, label: platformLabel(p) }));
  const memberItems = members.map((m) => ({ userId: m.userId, label: m.name }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Los filtros y el buscador viven en el encabezado de la lista: filtran esa columna. */}
      <PageHeader route="/dashboard/inbox" left={<SectionTabs />} />
      <div className="min-h-0 flex-1">
        <InboxView
      conversations={conversations}
      selected={selected}
      total={chunk.count ?? conversations.length}
      listQuery={listQuery}
      initialCursor={chunk.cursor}
      initialHasMore={chunk.hasMore}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      assets={assets}
      canManageAssets={canManageAssets}
      canCreateTask={canCreateTask} // @plantilla-quitar(tareas)
      canViewAgentRuns={canViewAgentRuns}
      canAssignConversations={canAssignConversations}
      canEditContacts={permissionCtx.can("contacts.edit")}
      canDeleteContacts={permissionCtx.can("contacts.delete")}
      canMergeContacts={permissionCtx.can("contacts.merge")}
      canDeleteConversations={permissionCtx.can("conversations.delete")}
      replyChannelIds={replyFilterFor(access.permissions)}
      filters={filters}
      dateRange={range}
      tags={tags}
      members={memberItems}
      agentByChannel={agentByChannel}
      providerByChannel={providerByChannel}
      accounts={accountInfo}
      currentUserId={user.id}
      isAdmin={isAdminRole(role)}
      draftCounts={draftCounts}
      draftConversationIds={draftConversationIds}
      hasGroups={(groupsCount.count ?? 0) > 0}
      unidentifiedCount={hiddenRes.count ?? 0}
      groups={allGroups}
      groupsTotal={allGroups.length}
      selectedGroup={openGroup?.group ?? null}
      groupThread={openGroup?.thread ?? []}
      canCreateGroupAutomation={permissionCtx.can("flows.edit")}
      canManageGroups={canManageGroups}
      filterCatalog={{ platforms: platformItems, accounts, multiPlatforms: multiAccountPlatforms(accounts), tags, members: memberItems, communities }}
        />
      </div>
    </div>
  );
}

const EMPTY_CHUNK: InboxChunk = { rows: [], hasMore: false, cursor: null, newestOnNext: undefined, count: 0, error: null };
