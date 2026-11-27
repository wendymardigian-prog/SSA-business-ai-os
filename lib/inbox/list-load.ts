import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { Platform } from "@/lib/platforms";
import { contactSearchFilter } from "@/lib/contacts/search";
import { contactIdsByWhatsappLid } from "@/lib/contacts/search-lid";
import {
  ASSIGNMENT_UNASSIGNED,
  ASSIGNMENT_AI,
  ASSIGNMENT_MINE,
  ASSIGNMENT_ANY,
  SILENT_OUTREACH_FIELD,
  statusForQuery,
  type InboxFilters,
} from "@/lib/inbox/filters";
import { awaitingQueryBounds } from "@/lib/inbox/awaiting";
import { LIVE_DRAFT_STATUSES } from "@/lib/agent/drafts/types";
import type { ConversationRow } from "@/lib/inbox/types";
import { cursorOf, keysetFilter, type ListCursor } from "@/lib/inbox/list-cursor";

/**
 * La consulta de la lista de la bandeja, en UN solo lugar.
 *
 * La usan la pagina (la primera tanda), «cargar mas» (las siguientes) y el
 * tiempo real (un chat que cambio, por id). Que las tres pasen por aca es lo que
 * garantiza que un chat que llega en vivo cumple exactamente los mismos filtros
 * que la lista, tambien los que solo sabe la base (etiquetas, responsable,
 * «sin identificar», busqueda).
 *
 * Siempre con el cliente de la SESION: la RLS (`can_see_conversation`) decide que
 * chats ve cada persona.
 */

/** Cuantos chats trae cada tanda. */
export const INBOX_CHUNK_SIZE = 30;

/** Cuantos ids se le preguntan a la base de una vez desde el tiempo real. */
export const INBOX_MAX_IDS = 50;

export const INBOX_LIST_SELECT =
  "*, contacts!inner(id, display_name, avatar_url, do_not_contact, do_not_contact_reason, setter_id, vendedor_id, last_interaction_at, is_known, known_marked_by, is_customer, customer_marked_by, customer_source)";

type Client = SupabaseClient<Database>;

export interface InboxListQueryInput {
  workspaceId: string;
  userId: string;
  filters: InboxFilters;
  range: { from: string | null; to: string | null };
  /** Las cuentas que ve esta persona; null = todas. */
  channelRestriction: string[] | null;
}

const NO_CHANNEL = "00000000-0000-0000-0000-000000000000";

/**
 * Devuelve la consulta envuelta en un objeto: la consulta de supabase-js es "thenable" y un `await` sobre ella
 * (que es lo que haria devolverla directo desde una funcion async) la ejecutaria antes de ponerle el orden.
 */
async function buildQuery(supabase: Client, input: InboxListQueryInput, withCount: boolean) {
  const { filters, range, channelRestriction, workspaceId } = input;
  // El inner join con alias recorta que conversaciones vuelven sin perder los
  // datos del contacto de las que vuelven. Es el mismo mecanismo que usa la
  // lista de contactos para filtrar por tag.
  let select = INBOX_LIST_SELECT;
  if (filters.tagIds.length > 0) select += ", tag_match:contacts!inner(contact_tags!inner(tag_id))";

  let query = supabase
    .from("conversations")
    .select(select, withCount ? { count: "exact" } : undefined)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const statusValue = statusForQuery(filters.status);
  if (statusValue) query = query.eq("status", statusValue);
  if (channelRestriction) {
    // Una lista vacia es "no ve ninguna cuenta": un id que no existe no trae nada.
    query = query.in("channel_id", channelRestriction.length > 0 ? channelRestriction : [NO_CHANNEL]);
  }
  if (filters.platforms.length > 0) query = query.in("platform", filters.platforms as Platform[]);
  if (filters.channelIds.length > 0) query = query.in("channel_id", filters.channelIds);
  if (filters.tagIds.length > 0) query = query.in("tag_match.contact_tags.tag_id", filters.tagIds);
  if (range.from) query = query.gte("last_message_at", range.from);
  if (range.to) query = query.lte("last_message_at", range.to);
  // Fase 3: las conversaciones donde el agente fallo (indice parcial 00059).
  if (filters.agentError) query = query.not("last_agent_error_at", "is", null);
  // Índice parcial de la 00103.
  if (filters.needsHuman) query = query.eq("needs_human", true);
  if (filters.awaiting) {
    // Lo mismo que chat_waiting_now_v2 (00259): el lead espera hace mas de una
    // hora, nadie marco que no necesita respuesta, ninguna etiqueta apago al
    // agente y el contacto no esta en "no contactar".
    const { waitingBefore, nowIso } = awaitingQueryBounds();
    query = query
      .not("awaiting_last_inbound_at", "is", null)
      .lt("awaiting_last_inbound_at", waitingBefore)
      .is("no_reply_needed_at", null)
      .is("agent_disabled_by_tag_id", null)
      .not("contacts.do_not_contact", "is", true);
    query =
      filters.awaiting === "responder"
        ? query.or(`reply_window_until.is.null,reply_window_until.gt.${nowIso}`)
        : query.lte("reply_window_until", nowIso);
  }
  if (filters.hideKnown) query = query.eq("contacts.is_known", false);
  if (filters.hideCustomers) query = query.eq("contacts.is_customer", false);
  query = query.filter(SILENT_OUTREACH_FIELD, "eq", filters.onlyUnidentified);

  if (filters.search) {
    // Sobre el contacto (la tabla embebida): nombre, emails, telefonos, los @ y el
    // id de WhatsApp de quien escribio sin numero. La misma regla que Contactos
    // (lib/contacts/search.ts).
    const lidContactIds = await contactIdsByWhatsappLid(supabase as SupabaseClient, workspaceId, filters.search);
    const filter = contactSearchFilter(filters.search, lidContactIds);
    if (filter) query = query.or(filter, { referencedTable: "contacts" });
  }

  const assignment = filters.assignment;
  if (assignment === ASSIGNMENT_UNASSIGNED) {
    // "Sin asignar" es sin nadie por ninguna de las tres vias: un lead con vendedor ya tiene dueño.
    query = query.is("assigned_to", null).is("contacts.setter_id", null).is("contacts.vendedor_id", null);
  } else if (assignment === ASSIGNMENT_AI) {
    query = query.is("assigned_to", null);
  } else if (assignment && assignment !== ASSIGNMENT_ANY) {
    // Una persona: el chat a su cargo, o es setter o vendedor del contacto (`conversation_people`, 00255).
    const personId = assignment === ASSIGNMENT_MINE ? input.userId : assignment;
    query = query.filter("conversation_people", "cs", `{${personId}}`);
  }
  return { query };
}

/**
 * El select dinamico no se puede tipar en tiempo de compilacion. La forma que
 * vuelve es la fila de conversations tal cual mas el contacto embebido, que es
 * lo que ya esperan la lista y el hilo; el cast se hace aca, en un solo lugar.
 */
export function toRows(data: unknown): ConversationRow[] {
  return (data ?? []) as unknown as ConversationRow[];
}

export interface InboxChunk {
  rows: ConversationRow[];
  /** Si hay mas para cargar despues de esta tanda. */
  hasMore: boolean;
  /** Donde arranca la tanda siguiente. Sale de la ultima fila CRUDA (antes del filtro «IA»). */
  cursor: ListCursor | null;
  /** La primera fila de la tanda siguiente: hasta donde llegan los grupos de esta. */
  newestOnNext: string | null | undefined;
  /** Solo en la primera tanda. */
  count: number | null;
  error: string | null;
}

/** Una tanda de la lista: la primera (sin cursor) o la que sigue a `cursor`. */
export async function loadInboxChunk(
  supabase: Client,
  input: InboxListQueryInput,
  opts: { cursor: ListCursor | null; withCount: boolean },
): Promise<InboxChunk> {
  let { query } = await buildQuery(supabase, input, opts.withCount);
  if (opts.cursor) query = query.or(keysetFilter(opts.cursor));
  // Una fila de mas: dice si hay otra tanda y hasta donde llegan los grupos de esta.
  const res = await query
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(INBOX_CHUNK_SIZE + 1);

  if (res.error) {
    return { rows: [], hasMore: false, cursor: opts.cursor, newestOnNext: undefined, count: null, error: res.error.message };
  }
  const raw = toRows(res.data);
  const page = raw.slice(0, INBOX_CHUNK_SIZE);
  const hasMore = raw.length > INBOX_CHUNK_SIZE;
  const rows = input.filters.assignment === ASSIGNMENT_AI ? await keepOnlyBotAnswered(supabase, page) : page;
  return {
    rows,
    hasMore,
    cursor: page.length > 0 ? cursorOf(page[page.length - 1]) : opts.cursor,
    newestOnNext: hasMore ? raw[INBOX_CHUNK_SIZE].last_message_at : undefined,
    count: opts.withCount ? (res.count ?? null) : null,
    error: null,
  };
}

/**
 * De estos ids, cuales entran HOY en la lista con estos filtros (y como estan).
 * Es lo que usa el tiempo real: en vez de rehacer la pagina entera por un chat
 * que cambio, se pregunta solo por ese chat.
 */
export async function loadInboxRowsByIds(
  supabase: Client,
  input: InboxListQueryInput,
  ids: string[],
): Promise<{ rows: ConversationRow[]; notMatching: string[]; error: string | null }> {
  if (ids.length === 0) return { rows: [], notMatching: [], error: null };
  const { query } = await buildQuery(supabase, input, false);
  const res = await query.in("id", ids).limit(ids.length);
  if (res.error) return { rows: [], notMatching: [], error: res.error.message };
  let rows = toRows(res.data);
  if (input.filters.assignment === ASSIGNMENT_AI) rows = await keepOnlyBotAnswered(supabase, rows);
  const found = new Set(rows.map((r) => r.id));
  return { rows, notMatching: ids.filter((id) => !found.has(id)), error: null };
}

/** Deja solo las conversaciones donde algun mensaje salio de un flow. */
async function keepOnlyBotAnswered(supabase: Client, conversations: ConversationRow[]): Promise<ConversationRow[]> {
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
export async function loadDraftConversationIds(supabase: Client, conversationIds: string[]): Promise<string[]> {
  if (conversationIds.length === 0) return [];
  const { data, error } = await supabase
    .from("agent_drafts")
    .select("conversation_id")
    .in("conversation_id", conversationIds)
    .in("status", LIVE_DRAFT_STATUSES);
  if (error) {
    console.error("[inbox] no pude leer los borradores de la lista:", error.message);
    return [];
  }
  return [...new Set((data ?? []).map((d) => d.conversation_id))];
}
