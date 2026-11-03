/**
 * La lista de contactos: conversaciones de la bandeja.
 *
 * El responsable del chat es `conversations.assigned_to` (el mismo que usa la
 * RLS: te asignan un chat → el contacto es tuyo). "Esperando respuesta" es la
 * misma marca que mantiene el trigger de `messages` (00259): el lead escribió y
 * nadie le contestó, y no se marcó como que no hace falta.
 *
 * Los filtros respetan la RLS de `conversations` (`can_see_conversation`).
 */
import { platformLabel } from "@/lib/platforms";
import { NONE, UUID_RE, byContact, fillCells, type CellValue, type ContactFilterDef, type ContactListModule, type ListGroupDef } from "../filters/types";
import { hasRelatedFilter } from "../filters/catalog";

export const CONVERSATIONS_GROUP: ListGroupDef = { key: "conversaciones", label: "Conversaciones", order: 90 };

const ALIVE = [{ op: "is_null", column: "deleted_at" }] as const;

const assigneeFilter: ContactFilterDef = {
  param: "responsable",
  label: "Responsable del chat",
  group: CONVERSATIONS_GROUP,
  kind: "multi",
  related: true,
  options: { from: "members", none: "Sin responsable" },
  keywords: "asignado bandeja asignacion",
  hint: "Alguna de sus conversaciones está a cargo de esta persona.",
  accepts: (v) => v === NONE || UUID_RE.test(v),
  plan: (values) => {
    const ids = values.filter((v) => v !== NONE);
    const hasNone = values.includes(NONE);
    const condition = hasNone && ids.length === 0
      ? { op: "is_null" as const, column: "assigned_to" }
      : hasNone
        ? { op: "or" as const, filter: `assigned_to.is.null,assigned_to.in.(${ids.join(",")})` }
        : { op: "in" as const, column: "assigned_to", values: ids };
    return { related: [{ relation: "conversations", mode: "has", columns: ["assigned_to", "deleted_at"], clauses: [...ALIVE, condition] }] };
  },
};

interface ConversationRow {
  contact_id: string;
  platform: string;
  assigned_to: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  awaiting_reply_since: string | null;
  no_reply_needed_at: string | null;
}

export const conversationsModule: ContactListModule = {
  key: "conversaciones",
  filters: [
    assigneeFilter,
    hasRelatedFilter({
      param: "esperando",
      label: "Esperando respuesta",
      group: CONVERSATIONS_GROUP,
      relation: "conversations",
      columns: ["awaiting_reply_since", "no_reply_needed_at", "deleted_at"],
      clauses: [...ALIVE, { op: "not_null", column: "awaiting_reply_since" }, { op: "is_null", column: "no_reply_needed_at" }],
      keywords: "sin responder pendiente bandeja",
      hint: "Escribió y nadie le contestó todavía.",
    }),
  ],
  columns: [
    { key: "chat_owner", label: "Responsable del chat", group: CONVERSATIONS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "asignado" },
    { key: "channels", label: "Canales", group: CONVERSATIONS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "instagram whatsapp" },
    { key: "last_message", label: "Último mensaje", group: CONVERSATIONS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "chat" },
    { key: "awaiting", label: "Esperando respuesta", group: CONVERSATIONS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "sin responder" },
  ],
  async loadCells(supabase, workspaceId, contactIds, keys) {
    const { data, error } = await supabase
      .from("conversations")
      .select("contact_id, platform, assigned_to, last_message_at, last_message_preview, awaiting_reply_since, no_reply_needed_at")
      .eq("workspace_id", workspaceId)
      .in("contact_id", [...contactIds])
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return conversationCells(contactIds, keys, (data ?? []) as ConversationRow[]);
  },
};

/** Puro: las celdas a partir de las conversaciones de la página (la más reciente primero). */
export function conversationCells(contactIds: readonly string[], keys: readonly string[], rows: readonly ConversationRow[]) {
  const grouped = byContact(rows);
  return fillCells(contactIds, keys, (id) => {
    const list = grouped.get(id) ?? [];
    const latest = list[0];
    const owner = list.find((c) => c.assigned_to)?.assigned_to ?? null;
    const waiting = list
      .filter((c) => c.awaiting_reply_since && !c.no_reply_needed_at)
      .map((c) => c.awaiting_reply_since as string)
      .sort()[0];
    const cells: Record<string, CellValue> = {
      chat_owner: owner ? { t: "member", userId: owner } : null,
      channels: list.length > 0 ? { t: "list", items: [...new Set(list.map((c) => platformLabel(c.platform)))] } : null,
      last_message: latest?.last_message_at
        ? { t: "date", at: latest.last_message_at, mode: "relative", ...(latest.last_message_preview ? { sub: latest.last_message_preview.slice(0, 60) } : {}) }
        : null,
      awaiting: waiting ? { t: "date", at: waiting, mode: "relative", sub: "Esperando respuesta" } : null,
    };
    return cells;
  });
}
