import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentDraftStatus, Database } from "@/lib/types/database";
import { messagingWindowHours } from "@/lib/messaging-window";
import { platformLabel } from "@/lib/platforms";
import { firstParam, pickEnum, pickPage, type SearchParams } from "@/lib/url-params";
import {
  LIVE_DRAFT_STATUSES,
  parseAppliedActions,
  parseSuggestedActions,
  type AppliedAction,
  type SuggestedAction,
} from "./types";
import { isAboutToExpire, windowInfo, type WindowInfo } from "./window-state";

/**
 * La cola de borradores (Bloque 2c): filtros que viven en la URL y la consulta
 * que los traduce. Se lee con el cliente del USUARIO: la RLS de agent_drafts
 * (EXISTS sobre conversations) ya acota a un Member a sus leads.
 *
 * De quien es un borrador: se hereda del contacto, sin campo propio (un
 * assigned_to en el borrador se desincronizaria en cuanto alguien reasigna el
 * contacto). Regla: el setter; sin setter, el vendedor; sin ninguno, "sin
 * asignar". El bucket "sin asignar" es visible a proposito: un borrador que no
 * es de nadie es exactamente como se pierde una ventana.
 *
 * Los pendientes (vivos) son pocos por naturaleza: se traen todos, se ordenan
 * y se paginan aca, porque el orden (por ventana, con los cerrados y los sin
 * ventana al fondo) y el filtro por dueno no se expresan en PostgREST. El
 * historial ("todos") pagina en la base.
 */

type Db = SupabaseClient<Database>;

export const DRAFTS_PAGE_SIZE = 25;
const LIVE_FETCH_LIMIT = 500;

export const QUIEN_MINE = "mios";
export const QUIEN_UNASSIGNED = "sin-asignar";
export const QUIEN_ALL = "todos";

export interface DraftFilters {
  /** mios (default) | sin-asignar | todos | <userId> */
  quien: string;
  estado: "pendientes" | "todos";
  ventana: "" | "por-vencer" | "cerradas";
  canal: string;
  contacto: string;
  page: number;
}

const UUID = /^[0-9a-f-]{36}$/i;

export function parseDraftFilters(params: SearchParams, known: { memberIds: string[]; channelIds: string[] }): DraftFilters {
  const quienRaw = firstParam(params.quien);
  const quien =
    quienRaw === QUIEN_UNASSIGNED || quienRaw === QUIEN_ALL
      ? quienRaw
      : known.memberIds.includes(quienRaw)
        ? quienRaw
        : QUIEN_MINE;
  return {
    quien,
    estado: pickEnum(params.estado, ["pendientes", "todos"] as const, "pendientes"),
    ventana: pickEnum(params.ventana, ["por-vencer", "cerradas"] as const),
    canal: pickEnum(params.canal, known.channelIds),
    contacto: UUID.test(firstParam(params.contacto)) ? firstParam(params.contacto) : "",
    page: pickPage(params.page),
  };
}

/** De quien es un borrador: setter del contacto; sin setter, vendedor; si no, nadie. */
export function draftOwner(contact: { setter_id: string | null; vendedor_id: string | null } | null | undefined): string | null {
  return contact?.setter_id ?? contact?.vendedor_id ?? null;
}

export function matchesOwner(owner: string | null, quien: string, userId: string): boolean {
  if (quien === QUIEN_ALL) return true;
  if (quien === QUIEN_UNASSIGNED) return owner === null;
  if (quien === QUIEN_MINE) return owner === userId;
  return owner === quien;
}

/**
 * El orden de la cola: lo que vence antes, primero. Los cerrados van al fondo
 * (ya no se pueden enviar: son "responder a mano"), y los sin ventana (canales
 * como WhatsApp por Evolution) al final tambien. A igual ventana, el mas viejo.
 * Con un solo canal da casi lo mismo que "mas viejo primero"; con dos canales
 * de plazos distintos, el orden por fecha mentiria.
 */
export function compareQueue(
  a: { sendable_until: string | null; created_at: string },
  b: { sendable_until: string | null; created_at: string },
  now: Date,
): number {
  const rank = (d: { sendable_until: string | null }) => {
    if (!d.sendable_until) return 2;
    return new Date(d.sendable_until).getTime() <= now.getTime() ? 1 : 0;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a.sendable_until && b.sendable_until && a.sendable_until !== b.sendable_until) {
    return new Date(a.sendable_until).getTime() - new Date(b.sendable_until).getTime();
  }
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

export interface DraftQueueRow {
  id: string;
  status: AgentDraftStatus;
  body: string | null;
  bodyParts: string[];
  noReplyReason: string | null;
  suggestedActions: SuggestedAction[];
  appliedActions: AppliedAction[];
  sendError: string | null;
  sentBody: string | null;
  discardReason: string | null;
  regenerateInstruction: string | null;
  previousDraftId: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  sendableUntil: string | null;
  windowHours: number;
  window: WindowInfo;
  conversationId: string;
  ownerId: string | null;
  contact: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
    username: string | null;
    doNotContact: boolean;
    doNotContactReason: string | null;
  };
  channel: { id: string; platform: string; label: string };
  /** Los mensajes del lead que responde, del mas viejo al mas nuevo. */
  burst: Array<{ id: string; text: string | null; createdAt: string }>;
}

export interface DraftQueue {
  rows: DraftQueueRow[];
  total: number;
  /** Vivos por vencer (menos de un cuarto de la ventana), para el contador del filtro. */
  aboutToExpire: number;
  /** Si hay algun borrador en el workspace, de cualquier estado (decide el empty state). */
  anyDraft: boolean;
}

const QUEUE_COLUMNS =
  "id, status, body, body_parts, no_reply_reason, suggested_actions, applied_actions, send_error, sent_body, discard_reason, regenerate_instruction, previous_draft_id, created_at, decided_at, decided_by, sendable_until, conversation_id, contact_id, channel_id, burst_message_ids, contacts!inner(id, display_name, avatar_url, instagram_username, setter_id, vendedor_id, do_not_contact, do_not_contact_reason), channels(id, platform, messaging_window_hours)";

interface RawDraft {
  id: string;
  status: AgentDraftStatus;
  body: string | null;
  body_parts: unknown;
  no_reply_reason: string | null;
  suggested_actions: unknown;
  applied_actions: unknown;
  send_error: string | null;
  sent_body: string | null;
  discard_reason: string | null;
  regenerate_instruction: string | null;
  previous_draft_id: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  sendable_until: string | null;
  conversation_id: string;
  contact_id: string;
  channel_id: string;
  burst_message_ids: string[] | null;
  contacts: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    instagram_username: string | null;
    setter_id: string | null;
    vendedor_id: string | null;
    do_not_contact: boolean;
    do_not_contact_reason: string | null;
  } | null;
  channels: { id: string; platform: string; messaging_window_hours: number | null } | null;
}

function toRow(raw: RawDraft, now: Date, messages: Map<string, { text: string | null; created_at: string }>): DraftQueueRow {
  const platform = raw.channels?.platform ?? "";
  const hours = raw.channels ? messagingWindowHours(raw.channels) : 0;
  return {
    id: raw.id,
    status: raw.status,
    body: raw.body,
    bodyParts: Array.isArray(raw.body_parts) ? raw.body_parts.filter((p): p is string => typeof p === "string") : [],
    noReplyReason: raw.no_reply_reason,
    suggestedActions: parseSuggestedActions(raw.suggested_actions),
    appliedActions: parseAppliedActions(raw.applied_actions),
    sendError: raw.send_error,
    sentBody: raw.sent_body,
    discardReason: raw.discard_reason,
    regenerateInstruction: raw.regenerate_instruction,
    previousDraftId: raw.previous_draft_id,
    createdAt: raw.created_at,
    decidedAt: raw.decided_at,
    decidedBy: raw.decided_by,
    sendableUntil: raw.sendable_until,
    windowHours: hours,
    window: windowInfo(raw.sendable_until, hours, now),
    conversationId: raw.conversation_id,
    ownerId: draftOwner(raw.contacts),
    contact: {
      id: raw.contact_id,
      name: raw.contacts?.display_name ?? null,
      avatarUrl: raw.contacts?.avatar_url ?? null,
      username: raw.contacts?.instagram_username ?? null,
      doNotContact: raw.contacts?.do_not_contact ?? false,
      doNotContactReason: raw.contacts?.do_not_contact_reason ?? null,
    },
    channel: { id: raw.channel_id, platform, label: platform ? platformLabel(platform) : "Canal" },
    burst: (raw.burst_message_ids ?? [])
      .map((id) => {
        const m = messages.get(id);
        return m ? { id, text: m.text, createdAt: m.created_at } : null;
      })
      .filter((m): m is { id: string; text: string | null; createdAt: string } => m !== null)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
  };
}

async function loadBurstMessages(user: Db, raws: RawDraft[]): Promise<Map<string, { text: string | null; created_at: string }>> {
  const ids = [...new Set(raws.flatMap((r) => r.burst_message_ids ?? []))].slice(0, 1000);
  if (ids.length === 0) return new Map();
  const { data, error } = await user.from("messages").select("id, text, created_at").in("id", ids);
  if (error) console.error("[drafts] no pude leer los mensajes de la cola:", error.message);
  return new Map((data ?? []).map((m) => [m.id, { text: m.text, created_at: m.created_at }]));
}

export async function loadDraftQueue(
  user: Db,
  args: { workspaceId: string; userId: string; filters: DraftFilters; now?: Date },
): Promise<DraftQueue> {
  const now = args.now ?? new Date();
  const f = args.filters;

  const { count: anyCount } = await user
    .from("agent_drafts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", args.workspaceId);
  const anyDraft = (anyCount ?? 0) > 0;

  if (f.estado === "pendientes") {
    let query = user
      .from("agent_drafts")
      .select(QUEUE_COLUMNS)
      .eq("workspace_id", args.workspaceId)
      .in("status", LIVE_DRAFT_STATUSES)
      .limit(LIVE_FETCH_LIMIT);
    if (f.canal) query = query.eq("channel_id", f.canal);
    if (f.contacto) query = query.eq("contact_id", f.contacto);
    const { data, error } = await query;
    if (error) {
      console.error("[drafts] no pude leer la cola:", error.message);
      return { rows: [], total: 0, aboutToExpire: 0, anyDraft };
    }
    const raws = ((data ?? []) as unknown as RawDraft[]).filter((r) => matchesOwner(draftOwner(r.contacts), f.quien, args.userId));
    const aboutToExpire = raws.filter((r) => {
      const hours = r.channels ? messagingWindowHours(r.channels) : 0;
      return isAboutToExpire(windowInfo(r.sendable_until, hours, now));
    }).length;
    const filtered = raws
      .filter((r) => {
        if (!f.ventana) return true;
        const info = windowInfo(r.sendable_until, r.channels ? messagingWindowHours(r.channels) : 0, now);
        return f.ventana === "por-vencer" ? isAboutToExpire(info) : info.level === "closed";
      })
      .sort((a, b) => compareQueue(a, b, now));
    const pageRaws = filtered.slice((f.page - 1) * DRAFTS_PAGE_SIZE, f.page * DRAFTS_PAGE_SIZE);
    const messages = await loadBurstMessages(user, pageRaws);
    return { rows: pageRaws.map((r) => toRow(r, now, messages)), total: filtered.length, aboutToExpire, anyDraft };
  }

  // Historial: todos los estados, del mas nuevo al mas viejo, paginado en la base.
  let query = user
    .from("agent_drafts")
    .select(QUEUE_COLUMNS, { count: "exact" })
    .eq("workspace_id", args.workspaceId)
    .order("created_at", { ascending: false })
    .range((f.page - 1) * DRAFTS_PAGE_SIZE, f.page * DRAFTS_PAGE_SIZE - 1);
  if (f.canal) query = query.eq("channel_id", f.canal);
  if (f.contacto) query = query.eq("contact_id", f.contacto);
  if (f.quien === QUIEN_UNASSIGNED) {
    query = query.is("contacts.setter_id", null).is("contacts.vendedor_id", null);
  } else if (f.quien !== QUIEN_ALL) {
    const who = f.quien === QUIEN_MINE ? args.userId : f.quien;
    query = query.or(`setter_id.eq.${who},and(setter_id.is.null,vendedor_id.eq.${who})`, { referencedTable: "contacts" });
  }
  const { data, error, count } = await query;
  if (error) {
    console.error("[drafts] no pude leer el historial:", error.message);
    return { rows: [], total: 0, aboutToExpire: 0, anyDraft };
  }
  const raws = (data ?? []) as unknown as RawDraft[];
  const messages = await loadBurstMessages(user, raws);
  return { rows: raws.map((r) => toRow(r, now, messages)), total: count ?? raws.length, aboutToExpire: 0, anyDraft };
}

/** El borrador vivo de una conversacion, para mostrarlo arriba del campo de escritura. */
export async function loadLiveDraft(user: Db, conversationId: string, now: Date = new Date()): Promise<DraftQueueRow | null> {
  const { data, error } = await user
    .from("agent_drafts")
    .select(QUEUE_COLUMNS)
    .eq("conversation_id", conversationId)
    .in("status", LIVE_DRAFT_STATUSES)
    .maybeSingle();
  if (error) {
    console.error("[drafts] no pude leer el borrador de la conversacion:", error.message);
    return null;
  }
  if (!data) return null;
  const raw = data as unknown as RawDraft;
  const messages = await loadBurstMessages(user, [raw]);
  return toRow(raw, now, messages);
}
