import { getWorkspace } from "@/lib/workspace";
import { getPermissionContext } from "@/lib/auth/guards";
import { firstParam } from "@/lib/url-params";
import { accountLabel } from "@/lib/inbox/accounts";
import { canWriteWhatsappGroup, grantFor } from "@/lib/auth/channel-permissions";
import { buildThread, participantLabel, type GroupListRow, type ThreadInput } from "@/lib/whatsapp-groups/thread";
import { PageHeader } from "@/components/page-header";
import { SectionTabs } from "@/components/comunicacion/section-tabs";
import { GroupsView, type SelectedGroup } from "@/components/inbox/groups/groups-view";

/** Cuantos mensajes del hilo se cargan (los mas nuevos). */
const THREAD_LIMIT = 150;

/**
 * La vista «Grupos» de la bandeja (`?vista=grupos`, `?g=<grupo>`). Todo se lee con el cliente del USUARIO: la RLS
 * (`can_see_whatsapp_group`) decide que grupos ve, y los contactos vinculados salen solo si los puede ver.
 */
export async function GroupsInbox({ params }: { params: Record<string, string | string[] | undefined> }) {
  const { workspace, supabase, role } = await getWorkspace();
  const access = await getPermissionContext();
  const isAdmin = role === "owner" || role === "admin";

  const [{ data: groupRows }, { data: channels }] = await Promise.all([
    supabase
      .from("whatsapp_groups")
      .select("id, channel_id, group_jid, subject, last_message_at, last_message_preview, unread_count")
      .eq("workspace_id", workspace.id)
      .eq("in_inbox", true)
      .is("left_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false }),
    supabase.from("channels").select("id, platform, username, display_name").eq("workspace_id", workspace.id),
  ]);
  const channelById = new Map((channels ?? []).map((c) => [c.id, c]));
  const labelOf = (channelId: string) => {
    const c = channelById.get(channelId);
    return c ? accountLabel(c) : "WhatsApp";
  };

  const groups: GroupListRow[] = (groupRows ?? []).map((g) => ({
    id: g.id,
    subject: g.subject,
    channelLabel: labelOf(g.channel_id),
    lastMessageAt: g.last_message_at,
    preview: g.last_message_preview,
    unread: g.unread_count,
  }));

  const selectedId = firstParam(params.g);
  const row = (groupRows ?? []).find((g) => g.id === selectedId) ?? null;
  let selected: SelectedGroup | null = null;
  let thread: ReturnType<typeof buildThread> = [];

  if (row) {
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
      for (const link of (links ?? []) as Array<{ platform_sender_id: string; contact_id: string; contacts: { display_name: string | null } | null }>) {
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
    thread = buildThread(input);
    selected = {
      id: row.id,
      subject: row.subject,
      channelLabel: labelOf(row.channel_id),
      canWrite: isAdmin || canWriteWhatsappGroup(grantFor(access.permissions?.channels, row.channel_id)),
      members: (members ?? []).map((m) => ({
        key: m.participant_id,
        label: participantLabel(input, m.participant_id) ?? m.participant_id,
        contactId: contacts[m.participant_id]?.id ?? null,
      })),
    };
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/inbox" left={<SectionTabs />} />
      <div className="min-h-0 flex-1">
        <GroupsView
          groups={groups}
          selected={selected}
          thread={thread}
          canCreateAutomation={access.can("flows.edit")}
          canManageGroups={access.can("channels.manage")}
        />
      </div>
    </div>
  );
}
