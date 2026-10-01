import { getWorkspace } from "@/lib/workspace";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { isAdminRole } from "@/lib/auth/roles";
import { platformLabel, type Platform } from "@/lib/platforms";
import { firstParam, listParam, pickEnum, pickIds, pickPage, sanitizeSearch } from "@/lib/url-params";
import { resolveDateRange, DATE_PRESETS, type DatePreset } from "@/lib/dates";
import {
  INBOX_STATUS_VALUES,
  DEFAULT_INBOX_STATUS,
  ASSIGNMENT_ANY,
  ASSIGNMENT_UNASSIGNED,
  ASSIGNMENT_AI,
  statusForQuery,
  type InboxFilters,
  type InboxStatus,
} from "@/lib/inbox/filters";
import { NEEDS_HUMAN_PARAM } from "@/lib/inbox/needs-human";
import { InboxView } from "./inbox-view";
import type { InboxAsset } from "@/components/inbox/message-thread";
import { AGENT_PUBLIC_COLUMNS, channelAgentInfo, type ChannelAgentInfo, type PublicAgent } from "@/lib/agent/public";
import type { ConversationRow } from "@/lib/inbox/types";
import { countPendingDrafts } from "@/lib/actions/agent-drafts";
import { LIVE_DRAFT_STATUSES } from "@/lib/agent/drafts/types";
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

const PAGE_SIZE = 30;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { workspace, supabase, user, role } = await getWorkspace();

  // Lo que necesitan los filtros para poder validar lo que viene de la URL:
  // un tag o un miembro inventado tiene que ignorarse, no llegar a la consulta.
  const [tagsRes, channelsRes, members, agentsRes] = await Promise.all([
    supabase.from("tags").select("id, name, color, disables_agent, assigns_to").eq("workspace_id", workspace.id).order("name"),
    supabase.from("channels").select("id, platform, provider").eq("workspace_id", workspace.id).eq("is_active", true),
    getWorkspaceMembers(workspace.id),
    // Columnas explicitas: los topes de gasto no son legibles para el usuario (00060).
    supabase.from("agents").select(AGENT_PUBLIC_COLUMNS).eq("workspace_id", workspace.id).is("deleted_at", null),
  ]);

  // Por canal, si el agente lo atiende: decide si el toggle se puede operar.
  const agents = (agentsRes.data ?? []) as PublicAgent[];
  const agentByChannel: Record<string, ChannelAgentInfo> = Object.fromEntries(
    (channelsRes.data ?? []).map((c) => [c.id, channelAgentInfo(agents, { id: c.id, label: platformLabel(c.platform) })]),
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
  const platformOptions = [...new Set((channelsRes.data ?? []).map((c) => c.platform))].sort() as Platform[];

  const search = sanitizeSearch(firstParam(params.q));
  const status = pickEnum<InboxStatus, InboxStatus>(
    params.estado,
    INBOX_STATUS_VALUES,
    DEFAULT_INBOX_STATUS,
  );
  const platforms = listParam(params.canal).filter((p) =>
    (platformOptions as string[]).includes(p),
  );
  const tagIds = pickIds(params.tag, tags.map((t) => t.id));
  const assignment = resolveAssignment(firstParam(params.asignado), members.map((m) => m.userId));
  const datePreset = pickEnum<DatePreset>(params.fecha, DATE_PRESETS);
  const dateFrom = firstParam(params.desde);
  const dateTo = firstParam(params.hasta);
  const agentError = firstParam(params["error-agente"]) === "1";
  // F11: las que el agente derivó porque no pudo entender lo que llegó.
  const needsHuman = firstParam(params[NEEDS_HUMAN_PARAM]) === "1";
  const page = pickPage(params.page);
  const selectedId = firstParam(params.c);

  const range = resolveDateRange(datePreset, dateFrom, dateTo);

  // El inner join con alias recorta que conversaciones vuelven sin perder los
  // datos del contacto de las que vuelven. Es el mismo mecanismo que usa la
  // lista de contactos para filtrar por tag.
  let select =
    "*, contacts!inner(id, display_name, avatar_url, do_not_contact, do_not_contact_reason, setter_id, vendedor_id, last_interaction_at)";
  if (tagIds.length > 0) select += ", tag_match:contacts!inner(contact_tags!inner(tag_id))";

  let query = supabase
    .from("conversations")
    .select(select, { count: "exact" })
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);

  const statusValue = statusForQuery(status);
  if (statusValue) query = query.eq("status", statusValue);
  if (platforms.length > 0) query = query.in("platform", platforms as Platform[]);
  if (tagIds.length > 0) query = query.in("tag_match.contact_tags.tag_id", tagIds);
  if (range.from) query = query.gte("last_message_at", range.from);
  if (range.to) query = query.lte("last_message_at", range.to);
  // Fase 3: las conversaciones donde el agente fallo (indice parcial 00059).
  if (agentError) query = query.not("last_agent_error_at", "is", null);
  // Índice parcial de la 00103.
  if (needsHuman) query = query.eq("needs_human", true);

  if (search) {
    // La busqueda por nombre del contacto va sobre la tabla embebida; el
    // preview sobre la propia. PostgREST no puede combinarlas con un OR, asi
    // que se busca por nombre, que es lo que se usa para encontrar a alguien.
    query = query.ilike("contacts.display_name", `%${search}%`);
  }

  if (assignment === ASSIGNMENT_UNASSIGNED) {
    // "Sin asignar" es sin nadie por ninguna de las tres vias, no solo sin
    // agente: un lead con vendedor ya tiene dueño.
    query = query
      .is("assigned_to", null)
      .is("contacts.setter_id", null)
      .is("contacts.vendedor_id", null);
  } else if (assignment === ASSIGNMENT_AI) {
    // No hay un usuario "IA" al que mirar: son las conversaciones sin humano
    // encima donde algo salio de un flow. Cuando llegue el agente de la Fase 3
    // el criterio sigue valiendo, porque va a escribir por el mismo camino.
    query = query.is("assigned_to", null);
  } else if (assignment) {
    query = query.or(
      `setter_id.eq.${assignment},vendedor_id.eq.${assignment}`,
      { referencedTable: "contacts" },
    );
  }

  const from = (page - 1) * PAGE_SIZE;

  const [conversationsRes, assetsRes, draftCounts] = await Promise.all([
    query
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    // La banca de recursos del selector "/" (textos y audios juntos).
    // Cualquier miembro la lee.
    supabase
      .from("response_assets")
      .select("id, kind, name, shortcut, content, transcript, tags, storage_path, mime_type, duration_seconds")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
    // Bloque 2d: el valor inicial de la pestana "Borradores (N)". Despues lo
    // mantiene al dia Realtime (useDraftCounts).
    countPendingDrafts(),
  ]);

  if (conversationsRes.error) {
    console.error("[inbox] listado fallido:", conversationsRes.error.message);
  }
  if (assetsRes.error) {
    console.error("[inbox] banca de recursos fallida:", assetsRes.error.message);
  }

  const assets: InboxAsset[] = (assetsRes.data ?? []).map((a) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    shortcut: a.shortcut,
    content: a.content,
    transcript: a.transcript,
    tags: a.tags,
    storagePath: a.storage_path,
    mimeType: a.mime_type,
    durationSeconds: a.duration_seconds,
  }));

  let conversations = toRows(conversationsRes.data);

  // "Agente IA" necesita saber si un flow escribio en la conversacion, y eso
  // esta en messages. Se resuelve despues de traer la pagina y no con un join:
  // un inner join a messages duplicaria filas y romperia el conteo.
  if (assignment === ASSIGNMENT_AI) {
    conversations = await keepOnlyBotAnswered(supabase, conversations);
  }

  // La conversacion abierta se trae aparte y sin filtros: un link compartido
  // tiene que abrir ese hilo aunque no entre en la pagina que se este viendo.
  let selected: ConversationRow | null =
    conversations.find((c) => c.id === selectedId) ?? null;

  if (selectedId && !selected) {
    const { data } = await supabase
      .from("conversations")
      .select(
        "*, contacts(id, display_name, avatar_url, do_not_contact, do_not_contact_reason, setter_id, vendedor_id, last_interaction_at)",
      )
      .eq("id", selectedId)
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .maybeSingle();
    selected = toRows(data ? [data] : [])[0] ?? null;
  }

  // Las conversaciones de esta pagina con un borrador del agente esperando
  // (Bloque 2d): llevan un chip para entrar directo al hilo. La RLS de
  // agent_drafts acota a un Member a sus leads.
  const draftConversationIds = await loadDraftConversationIds(supabase, [
    ...conversations.map((c) => c.id),
    ...(selected && !conversations.some((c) => c.id === selected!.id) ? [selected.id] : []),
  ]);

  const filters: InboxFilters = {
    search,
    status,
    platforms,
    tagIds,
    assignment,
    datePreset,
    dateFrom,
    dateTo,
    agentError,
    needsHuman,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/inbox" />
      <SectionTabs />
      <div className="min-h-0 flex-1">
        <InboxView
      conversations={conversations}
      selected={selected}
      total={conversationsRes.count ?? conversations.length}
      page={page}
      pageSize={PAGE_SIZE}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      assets={assets}
      filters={filters}
      dateRange={range}
      tags={tags}
      platforms={platformOptions.map((p) => ({ value: p, label: platformLabel(p) }))}
      members={members.map((m) => ({ userId: m.userId, label: m.name }))}
      agentByChannel={agentByChannel}
      providerByChannel={providerByChannel}
      currentUserId={user.id}
      isAdmin={isAdminRole(role)}
      draftCounts={draftCounts}
      draftConversationIds={draftConversationIds}
        />
      </div>
    </div>
  );
}

/** Un id de la URL solo vale si es de alguien del equipo. */
function resolveAssignment(raw: string, memberIds: string[]): string {
  if (!raw) return ASSIGNMENT_ANY;
  if (raw === ASSIGNMENT_UNASSIGNED || raw === ASSIGNMENT_AI) return raw;
  return memberIds.includes(raw) ? raw : ASSIGNMENT_ANY;
}

/**
 * El select dinamico no se puede tipar en tiempo de compilacion. La forma que
 * vuelve es la fila de conversations tal cual mas el contacto embebido, que es
 * lo que ya esperan la lista y el hilo; el cast se hace aca, en un solo lugar.
 */
function toRows(data: unknown): ConversationRow[] {
  return (data ?? []) as unknown as ConversationRow[];
}

/** Deja solo las conversaciones donde algun mensaje salio de un flow. */
async function keepOnlyBotAnswered(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  conversations: ConversationRow[],
): Promise<ConversationRow[]> {
  if (conversations.length === 0) return conversations;

  const { data } = await supabase
    .from("messages")
    .select("conversation_id")
    .in("conversation_id", conversations.map((c) => c.id))
    .not("sent_by_flow_id", "is", null);

  const answered = new Set((data ?? []).map((m) => m.conversation_id));
  return conversations.filter((c) => answered.has(c.id));
}

/** De estas conversaciones, cuales tienen un borrador vivo del agente. */
async function loadDraftConversationIds(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  conversationIds: string[],
): Promise<string[]> {
  if (conversationIds.length === 0) return [];
  const { data, error } = await supabase
    .from("agent_drafts")
    .select("conversation_id")
    .in("conversation_id", conversationIds)
    .in("status", LIVE_DRAFT_STATUSES);
  if (error) {
    console.error("[inbox] no pude leer los borradores de la pagina:", error.message);
    return [];
  }
  return [...new Set((data ?? []).map((d) => d.conversation_id))];
}
