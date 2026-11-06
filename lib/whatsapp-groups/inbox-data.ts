/**
 * Lo que la bandeja lee de los grupos de WhatsApp (00280), con el cliente del USUARIO: la RLS
 * (`can_see_whatsapp_group`) decide que grupos ve, y los contactos vinculados salen solo si los puede ver.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { accountLabel, type AccountSource } from "@/lib/inbox/accounts";
import { canWriteWhatsappGroup, grantFor } from "@/lib/auth/channel-permissions";
import type { InboxFilters } from "@/lib/inbox/filters";
import { buildThread, participantLabel, type GroupListRow, type SelectedGroup, type ThreadInput, type ThreadMessage } from "@/lib/whatsapp-groups/thread";
import type { RolePermissions } from "@/lib/auth/permissions";

/** Cuantos mensajes del hilo se cargan (los mas nuevos). */
const THREAD_LIMIT = 150;

const LIST_COLUMNS = "id, channel_id, group_jid, subject, last_message_at, last_message_preview, unread_count";

function labelFor(channels: AccountSource[], channelId: string): string {
  const channel = channels.find((c) => c.id === channelId);
  return channel ? accountLabel(channel) : "WhatsApp";
}

/**
 * Los grupos que cumplen los filtros que un grupo puede cumplir: la busqueda (por su nombre), la cuenta y la fecha del
 * ultimo mensaje. Los demas los decide `groupsCanMatch`, antes de llamar. Si falla, la lista sigue con los chats.
 */
export async function loadInboxGroups(
  supabase: SupabaseClient,
  workspaceId: string,
  channels: AccountSource[],
  filters: Pick<InboxFilters, "search" | "channelIds">,
  range: { from: string | null; to: string | null },
): Promise<GroupListRow[]> {
  let query = supabase
    .from("whatsapp_groups")
    .select(LIST_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("in_inbox", true)
    .is("left_at", null);
  // `sanitizeSearch` ya saco los comodines de lo que se busca.
  if (filters.search) query = query.ilike("subject", `%${filters.search}%`);
  if (filters.channelIds.length > 0) query = query.in("channel_id", filters.channelIds);
  if (range.from) query = query.gte("last_message_at", range.from);
  if (range.to) query = query.lte("last_message_at", range.to);

  const { data, error } = await query.order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("[inbox] no pude leer los grupos:", error.message);
    return [];
  }
  return (data ?? []).map((g) => ({
    id: g.id,
    channelId: g.channel_id,
    subject: g.subject,
    channelLabel: labelFor(channels, g.channel_id),
    lastMessageAt: g.last_message_at,
    preview: g.last_message_preview,
    unread: g.unread_count,
  }));
}

/**
 * El grupo abierto (`?g=`) y su hilo. Sin filtros: un link tiene que abrir ese grupo aunque no entre en lo que se esta
 * mirando. `null` si no existe o esta persona no lo ve.
 */
export async function loadSelectedGroup(
  supabase: SupabaseClient,
  workspaceId: string,
  groupId: string,
  channels: AccountSource[],
  viewer: { isAdmin: boolean; permissions: RolePermissions | null | undefined },
): Promise<{ group: SelectedGroup; thread: ThreadMessage[] } | null> {
  const { data: row, error } = await supabase
    .from("whatsapp_groups")
    .select(LIST_COLUMNS)
    .eq("id", groupId)
    .eq("workspace_id", workspaceId)
    .eq("in_inbox", true)
    .is("left_at", null)
    .maybeSingle();
  if (error) console.error("[inbox] no pude leer el grupo abierto:", error.message);
  if (!row) return null;

  const { data: recent } = await supabase
    .from("whatsapp_group_messages")
    .select("id, direction, sender_participant_id, sender_name, text, attachments, poll, origin, status, send_error, created_at")
    .eq("group_id", row.id)
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);
  const messages = recent ?? [];
  const ids = messages.map((m) => m.id);
  const [{ data: reactions }, { data: votes }, { data: members }] = await Promise.all([
    ids.length ? supabase.from("whatsapp_group_reactions").select("message_id, participant_id, emoji, removed_at").in("message_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("whatsapp_poll_votes").select("message_id, participant_id, selected_options").in("message_id", ids) : Promise.resolve({ data: [] }),
    supabase.from("whatsapp_group_members").select("participant_id, display_name, phone, left_at").eq("group_id", row.id).is("left_at", null).order("joined_at", { ascending: true }).limit(1000),
  ]);

  // Los contactos detras de cada participante: los que esta persona puede ver (RLS de contact_channels / contacts).
  const participantIds = Array.from(
    new Set([
      ...messages.map((m) => m.sender_participant_id),
      ...(members ?? []).map((m) => m.participant_id),
      ...(votes ?? []).map((v) => v.participant_id),
    ].filter((v): v is string => !!v && v !== "me")),
  ).slice(0, 1000);
  const contacts: ThreadInput["contacts"] = {};
  if (participantIds.length > 0) {
    const { data: links } = await supabase
      .from("contact_channels")
      .select("platform_sender_id, contact_id, contacts(display_name)")
      .eq("channel_id", row.channel_id)
      .in("platform_sender_id", participantIds);
    for (const link of (links ?? []) as unknown as Array<{ platform_sender_id: string; contact_id: string; contacts: { display_name: string | null } | null }>) {
      contacts[link.platform_sender_id] = { id: link.contact_id, name: link.contacts?.display_name ?? null };
    }
  }

  const input: ThreadInput = {
    messages,
    reactions: reactions ?? [],
    votes: (votes ?? []).map((v) => ({ ...v, selected_options: v.selected_options ?? [] })),
    members: (members ?? []).map((m) => ({ participant_id: m.participant_id, display_name: m.display_name, phone: m.phone })),
    contacts,
  };
  return {
    thread: buildThread(input),
    group: {
      id: row.id,
      subject: row.subject,
      channelLabel: labelFor(channels, row.channel_id),
      canWrite: viewer.isAdmin || canWriteWhatsappGroup(grantFor(viewer.permissions?.channels, row.channel_id)),
      members: (members ?? []).map((m) => ({
        key: m.participant_id,
        label: participantLabel(input, m.participant_id) ?? m.participant_id,
        contactId: contacts[m.participant_id]?.id ?? null,
      })),
    },
  };
}
