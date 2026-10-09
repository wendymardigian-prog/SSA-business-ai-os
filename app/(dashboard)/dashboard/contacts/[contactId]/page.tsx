import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, CalendarClock } from "lucide-react";

import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { buildAttributionView } from "@/lib/contacts/attribution-view";
import type { AuditAction, Json, LeadTemperature } from "@/lib/types/database";
import { PlatformIcon } from "@/components/platform-icon";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { getDmLink, platformHandles } from "@/lib/contacts/links";

import {
  DoNotContactBadge,
  EmptyHint,
  Section,
  TemperatureBadge,
  formatDateTime,
  formatRelative,
} from "@/components/contacts/ui";
import { ContactActions } from "@/components/contacts/contact-actions";
import { ContactDataSection } from "@/components/contacts/contact-data-section";
import { InlineField } from "@/components/contacts/inline-field";
import { TemperatureField } from "@/components/contacts/temperature-field";
import { AssignmentFields } from "@/components/contacts/assignment-fields";
import { NotesSection } from "@/components/contacts/notes-section";
import { FollowupField } from "@/components/contacts/followup-field";
import { TagsEditor } from "@/components/contacts/tags-editor";
import { QuickTagActions } from "@/components/contacts/quick-tag-actions";
import { CustomFieldsEditor } from "@/components/contacts/custom-fields-editor";
import { AttributionSection } from "@/components/contacts/attribution-section";
import { HistorySection } from "@/components/contacts/history-section";
import { buildContactHistory } from "@/lib/contacts/history";
import {
  ContactSequencesSection,
  type ContactEnrollment,
} from "@/components/contacts/sequences-section";
import {
  LinkSuggestionBanner,
  type LinkSuggestion,
} from "@/components/contacts/link-suggestion-banner";
import { ContactBookingsSection } from "@/components/contacts/bookings-section";
import { PageHeader } from "@/components/page-header";
import { resolveViewerTimezone } from "@/lib/user-timezone";

/**
 * Ficha de contacto (F14).
 *
 * Todo lo que sabemos del lead en una pantalla: datos, quien lo trabaja, sus
 * conversaciones separadas por canal, notas, tags, campos propios, de donde
 * vino y que le paso.
 *
 * Sobre el scope de leads: si un Member abre la ficha de un lead que no le
 * corresponde, la consulta no devuelve nada y esto da 404. No hace falta
 * chequear el rol aca — lo decide can_see_contact en la base (migracion 00024).
 */

/** Cuantas filas se leen de cada fuente del historial, y cuantas entradas se arman en total. */
const HISTORY_FETCH = 60;
const HISTORY_LIMIT = 80;

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  const { workspace, supabase, user, role } = await getWorkspace();
  const isAdmin = isAdminRole(role);

  const [
    contactRes,
    channelsRes,
    conversationsRes,
    fieldDefsRes,
    fieldValuesRes,
    tagsRes,
    auditRes,
    enrollmentsRes,
    activeSequencesRes,
    bookingsRes,
    touchesRes,
    flowEventsRes,
    emailLogRes,
  ] = await Promise.all([
      supabase
        .from("contacts")
        .select("*, contact_tags(tag_id)")
        .eq("id", contactId)
        .eq("workspace_id", workspace.id)
        .maybeSingle(),
      supabase
        .from("contact_channels")
        .select("id, platform_sender_id, platform_username, channels(platform, username, display_name)")
        .eq("contact_id", contactId),
      supabase
        .from("conversations")
        .select("id, channel_id, platform, status, last_message_at, last_message_preview, unread_count, assigned_to")
        .eq("contact_id", contactId)
        .eq("workspace_id", workspace.id)
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false }),
      supabase
        .from("custom_field_definitions")
        .select("id, name, type")
        .eq("workspace_id", workspace.id)
        // Un campo eliminado deja de pedirse en la ficha, pero su valor sigue
        // guardado por si la eliminacion fue un error.
        .is("deleted_at", null)
        .order("name"),
      supabase.from("contact_custom_fields").select("field_id, value").eq("contact_id", contactId),
      supabase.from("tags").select("id, name, color, disables_agent, assigns_to").eq("workspace_id", workspace.id).order("name"),
      supabase
        .from("audit_log")
        .select("id, action, changes, metadata, performed_at, performed_by")
        .eq("workspace_id", workspace.id)
        .eq("entity_type", "contact")
        .eq("entity_id", contactId)
        .order("performed_at", { ascending: false })
        .limit(HISTORY_FETCH),
      // Todas las secuencias por las que paso, no solo las que corren: saber
      // que ya recibio una bienvenida cambia lo que se le escribe hoy.
      supabase
        .from("sequence_enrollments")
        .select(
          "id, sequence_id, status, paused_reason, current_step_index, enrolled_at, completed_at, sequences(name)"
        )
        .eq("contact_id", contactId)
        .order("enrolled_at", { ascending: false })
        .limit(50),
      supabase
        .from("sequences")
        .select("id, name")
        .eq("workspace_id", workspace.id)
        .eq("status", "active")
        .order("name"),
      // Las reuniones del contacto (F38). Lo que se ve acá lo decide
      // `can_see_booking`, la misma regla que la pantalla de Agendas.
      supabase
        .from("bookings")
        .select("id, title, start_at, status, host_user_id")
        .eq("contact_id", contactId)
        .eq("workspace_id", workspace.id)
        .order("start_at", { ascending: false })
        .limit(20),
      // El camino de toques de atribucion (F88). Lo que se ve lo decide la RLS:
      // un Member ve los toques de los contactos que ya puede ver.
      supabase
        .from("contact_touches")
        .select("id, occurred_at, source, medium, content_label, content_post_id, origin")
        .eq("contact_id", contactId)
        .eq("workspace_id", workspace.id)
        .order("occurred_at", { ascending: true })
        .limit(100),
      // El historial junta todo lo automatico (migracion 00135 para los emails):
      // las automatizaciones que corrieron sobre este contacto...
      supabase
        .from("analytics_events")
        .select("id, event_type, flow_id, created_at")
        .eq("contact_id", contactId)
        .eq("workspace_id", workspace.id)
        .in("event_type", ["flow_started", "flow_completed"])
        .order("created_at", { ascending: false })
        .limit(HISTORY_FETCH),
      // ...y los emails automaticos que salieron para el. La RLS de email_log
      // (por contacto) hace que cada persona vea solo los de los leads que puede ver.
      supabase
        .from("email_log")
        .select("id, to_email, subject, status, related_entity_type, related_entity_id, created_at")
        .eq("contact_id", contactId)
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_FETCH),
    ]);

  const contact = contactRes.data;
  if (!contact) notFound();

  const viewerTimezone = await resolveViewerTimezone((workspace as { timezone?: string }).timezone);
  const attributionView = buildAttributionView({
    attribution: contact.attribution,
    rows: touchesRes.data ?? [],
    timeZone: viewerTimezone,
  });

  const members = await getWorkspaceMembers(workspace.id);
  const tagOptions = (tagsRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    disablesAgent: t.disables_agent,
    assignsTo: t.assigns_to,
  }));
  const labels = memberLabels(members);
  const contactBookings = (bookingsRes.data ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    startAt: b.start_at,
    status: b.status,
    hostName: labels.get(b.host_user_id) ?? null,
  }));
  const { data: schedulingProfile } = await supabase
    .from("scheduling_profiles")
    .select("timezone, time_format")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();
  const bookingTimezone = schedulingProfile?.timezone ?? (workspace as { timezone?: string }).timezone ?? "UTC";
  const bookingTimeFormat = schedulingProfile?.time_format ?? "24h";

  const assignedTagIds = (contact.contact_tags ?? []).map(
    (ct: { tag_id: string }) => ct.tag_id,
  );
  const valuesByField = new Map(
    (fieldValuesRes.data ?? []).map((v) => [v.field_id, v.value]),
  );


  const suggestions = await loadSuggestions(supabase, workspace.id, contact.metadata);

  const conversations = conversationsRes.data ?? [];
  const channels = channelsRes.data ?? [];
  // F17: platformHandles solo mira el canal cuya platform es "instagram", no
  // "el primer canal con username" (que para WhatsApp es el telefono).
  const handles = platformHandles(
    contact,
    channels.map((cc) => ({
      platform: (cc.channels as { platform?: string } | null)?.platform ?? "",
      username: cc.platform_username,
    })),
  );

  const enrollments: ContactEnrollment[] = (enrollmentsRes.data ?? []).map((e) => {
    const sequence = e.sequences as unknown as { name: string } | null;
    return {
      id: e.id,
      sequenceId: e.sequence_id,
      sequenceName: sequence?.name ?? "Secuencia eliminada",
      status: e.status,
      pausedReason: e.paused_reason,
      currentStepIndex: e.current_step_index,
      enrolledAt: e.enrolled_at,
      completedAt: e.completed_at,
    };
  });

  // Los nombres de las automatizaciones que aparecen en el historial (las del
  // audit, las del motor y las de los emails).
  const flowIds = new Set<string>();
  for (const e of flowEventsRes.data ?? []) if (e.flow_id) flowIds.add(e.flow_id);
  for (const a of auditRes.data ?? []) {
    const meta = a.metadata as Record<string, unknown> | null;
    if (a.action === "automation_triggered" && typeof meta?.flow_id === "string") flowIds.add(meta.flow_id);
  }
  for (const m of emailLogRes.data ?? []) if (m.related_entity_type === "flow" && m.related_entity_id) flowIds.add(m.related_entity_id);
  const { data: flowRows } = flowIds.size
    ? await supabase.from("flows").select("id, name").eq("workspace_id", workspace.id).in("id", [...flowIds])
    : { data: [] as Array<{ id: string; name: string }> };

  const history = buildContactHistory({
    audit: (auditRes.data ?? []).map((a) => ({
      id: a.id,
      action: a.action as AuditAction,
      changes: a.changes as Json | null,
      metadata: a.metadata as Json | null,
      performedAt: a.performed_at,
      actorLabel: a.performed_by ? (labels.get(a.performed_by) ?? "Alguien del equipo") : "El sistema",
    })),
    flowEvents: (flowEventsRes.data ?? []).map((e) => ({ id: e.id, eventType: e.event_type, flowId: e.flow_id, createdAt: e.created_at })),
    enrollments: enrollments.map((e) => ({ id: e.id, sequenceName: e.sequenceName, enrolledAt: e.enrolledAt, completedAt: e.completedAt })),
    emails: (emailLogRes.data ?? []).map((m) => ({
      id: m.id,
      toEmail: m.to_email,
      subject: m.subject,
      status: m.status,
      relatedEntityType: m.related_entity_type,
      relatedEntityId: m.related_entity_id,
      createdAt: m.created_at,
    })),
    flowNames: new Map((flowRows ?? []).map((f) => [f.id, f.name])),
    limit: HISTORY_LIMIT,
  });

  // Solo se puede inscribir por un canal donde ya haya una conversacion: sin
  // eso no hay por donde mandar el primer paso.
  const enrollableChannels = [
    ...new Map(
      conversations
        .filter((c) => c.channel_id)
        .map((c) => [c.channel_id as string, c.platform as string])
    ),
  ].map(([id, label]) => ({ id, label }));
  const temperature = contact.lead_temperature as LeadTemperature | null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/contacts/[contactId]"
        title={contact.display_name ?? "Sin nombre"}
        backHref={
          <Link
            href="/dashboard/contacts"
            aria-label="Volver a contactos"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <ContactAvatar avatarUrl={contact.avatar_url} displayName={contact.display_name} className="h-12 w-12 text-lg" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* El nombre se edita con un clic. */}
                <InlineField
                  contactId={contact.id}
                  field="display_name"
                  value={contact.display_name ?? ""}
                  label="Nombre"
                  placeholder="Sin nombre"
                  variant="title"
                />
                <TemperatureBadge value={temperature} />
                {contact.do_not_contact && <DoNotContactBadge />}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Última interacción: {formatRelative(contact.last_interaction_at)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <ContactActions
            contactId={contact.id}
            isAdmin={isAdmin}
            doNotContact={contact.do_not_contact}
            doNotContactReason={contact.do_not_contact_reason}
          />
        </div>
      </header>

      <div className="flex-1 overflow-auto px-8 py-6">
        {suggestions.length > 0 && (
          <div className="mb-6">
            <LinkSuggestionBanner
              contactId={contact.id}
              suggestions={suggestions}
              isAdmin={isAdmin}
            />
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          {/* Columna principal */}
          <div className="space-y-8">
            <NotesSection contactId={contact.id} notes={contact.notes} />

            <ContactDataSection
              contactId={contact.id}
              canEdit
              values={{
                email: contact.email ?? "",
                secondary_email: contact.secondary_email ?? "",
                phone: contact.phone ?? "",
                whatsapp_phone: contact.whatsapp_phone ?? "",
                country: contact.country ?? "",
                instagram_username: contact.instagram_username ?? "",
                tiktok_username: contact.tiktok_username ?? "",
                twitter_username: contact.twitter_username ?? "",
                facebook_id: contact.facebook_id ?? "",
                youtube_channel_id: contact.youtube_channel_id ?? "",
                linkedin_profile_url: contact.linkedin_profile_url ?? "",
                ai_conversation_summary: contact.ai_conversation_summary ?? "",
              }}
            />

            <Section title="Conversaciones">
              {conversations.length === 0 ? (
                <EmptyHint>
                  Todavía no hay conversaciones. Van a aparecer acá apenas este
                  contacto escriba por alguno de los canales conectados.
                </EmptyHint>
              ) : (
                <ul className="space-y-2">
                  {conversations.map((conv) => (
                    <li key={conv.id}>
                      <Link
                        href={`/dashboard/inbox?c=${conv.id}`}
                        className="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
                      >
                        <PlatformIcon platform={conv.platform} className="mt-0.5 h-4 w-4" size={16} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium capitalize text-muted-foreground">
                              {conv.platform} · {conv.status === "open" ? "abierta" : conv.status}
                              {conv.assigned_to && ` · ${labels.get(conv.assigned_to) ?? "asignada"}`}
                            </p>
                            <p className="text-[10px] text-muted-foreground/60">
                              {formatRelative(conv.last_message_at)}
                            </p>
                          </div>
                          <p className="mt-0.5 truncate text-sm">
                            {conv.last_message_preview || "Sin mensajes"}
                          </p>
                        </div>
                        {conv.unread_count > 0 && (
                          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                            {conv.unread_count}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <ContactSequencesSection
              enrollments={enrollments}
              canEnroll={isAdmin}
              contact={{
                id: contact.id,
                name: contact.display_name || contact.email || "Contacto sin nombre",
                channels: enrollableChannels,
              }}
              sequences={activeSequencesRes.data ?? []}
            />

            <ContactBookingsSection bookings={contactBookings} timezone={bookingTimezone} timeFormat={bookingTimeFormat} />

            <AttributionSection view={attributionView} />

            <HistorySection items={history} />
          </div>

          {/* Barra lateral */}
          <aside className="space-y-8">
            <Section title="Asignación">
              <AssignmentFields
                contactId={contact.id}
                members={members.map((m) => ({ userId: m.userId, label: m.name }))}
                setterId={contact.setter_id}
                vendedorId={contact.vendedor_id}
                currentUserId={user.id}
                isAdmin={isAdmin}
              />
            </Section>

            <Section title="Seguimiento">
              <div className="space-y-3">
                <TemperatureField contactId={contact.id} value={contact.lead_temperature} />
                <FollowupField
                  contactId={contact.id}
                  value={contact.next_followup_date}
                />
              </div>
            </Section>

            <Section title="Tags">
              <TagsEditor
                contactId={contact.id}
                allTags={tagOptions}
                assignedIds={assignedTagIds}
              />
            </Section>

            {tagOptions.some((t) => t.disablesAgent || t.assignsTo) && (
              <Section title="Acciones rápidas">
                <QuickTagActions
                  contactId={contact.id}
                  allTags={tagOptions}
                  assignedIds={assignedTagIds}
                  memberNames={Object.fromEntries(members.map((m) => [m.userId, m.name]))}
                />
              </Section>
            )}

            <Section title="Campos personalizados">
              <CustomFieldsEditor
                contactId={contact.id}
                fields={(fieldDefsRes.data ?? []).map((f) => ({
                  id: f.id,
                  name: f.name,
                  type: f.type,
                  value: valuesByField.get(f.id) ?? "",
                }))}
                canManage={isAdmin}
              />
            </Section>

            <Section title="Canales vinculados">
              {channels.length === 0 ? (
                <EmptyHint>Sin canales vinculados.</EmptyHint>
              ) : (
                <ul className="space-y-2">
                  {channels.map((cc) => {
                    const ch = cc.channels as {
                      platform?: string;
                      display_name?: string;
                      username?: string;
                    } | null;
                    const platform = ch?.platform ?? "";
                    // El telefono de WhatsApp no es un @handle (Evolution
                    // manda platform_username = telefono).
                    const isHandle = platform !== "whatsapp";
                    const raw = cc.platform_username || cc.platform_sender_id;
                    const { url } = getDmLink(platform as never, cc.platform_username ?? cc.platform_sender_id);
                    const label = raw ? (isHandle && cc.platform_username ? `@${raw}` : raw) : "";
                    return (
                      <li
                        key={cc.id}
                        className="flex items-center gap-3 rounded-lg border border-border p-3"
                      >
                        <PlatformIcon platform={platform} className="h-4 w-4" size={16} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {ch?.display_name ?? ch?.username ?? "Canal"}
                          </p>
                          {url && label ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate text-xs text-primary hover:underline"
                            >
                              {label}
                            </a>
                          ) : (
                            <p className="truncate text-xs text-muted-foreground">{label}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * Sugerencias de vinculacion guardadas en metadata.link_suggestions por
 * find_or_link_contact. Se resuelve el nombre de cada candidato para que el
 * aviso diga con quien vincular y no un uuid.
 *
 * Un candidato que ya no se puede ver (borrado, o fuera del scope de este
 * Member) se descarta en silencio: ofrecer vincular con algo invisible no
 * ayudaria a nadie.
 */
async function loadSuggestions(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  workspaceId: string,
  metadata: Json | null,
): Promise<LinkSuggestion[]> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];

  const raw = (metadata as Record<string, unknown>).link_suggestions;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const parsed = raw
    .map((item) => item as { contact_id?: string; reason?: string; handle?: string })
    .filter((item): item is { contact_id: string; reason?: string; handle?: string } =>
      typeof item.contact_id === "string",
    );

  if (parsed.length === 0) return [];

  const { data: candidates } = await supabase
    .from("contacts")
    .select("id, display_name")
    .eq("workspace_id", workspaceId)
    .in("id", parsed.map((p) => p.contact_id));

  const byId = new Map((candidates ?? []).map((c) => [c.id, c.display_name]));

  return parsed
    .filter((p) => byId.has(p.contact_id))
    .map((p) => ({
      contactId: p.contact_id,
      reason: p.reason ?? "username",
      handle: p.handle,
      candidateName: byId.get(p.contact_id) ?? null,
    }));
}
