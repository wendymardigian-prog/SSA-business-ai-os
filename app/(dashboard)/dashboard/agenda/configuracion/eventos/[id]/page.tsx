import { notFound, redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { getEventType, listCategories, toCategoryRow, toEventType } from "@/lib/scheduling/data/event-types";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { listSchedules, toSchedule } from "@/lib/scheduling/data/schedules";
import { calendarsForResolve } from "@/lib/scheduling/data/event-context";
import { listCalendarConnections } from "@/lib/scheduling/data/calendars";
import { resolveEventCalendars } from "@/lib/scheduling/resolve-calendars";
import { activationChecklist, canActivate, type EditorSection } from "@/lib/scheduling/event-validation";
import { validateBookingFields } from "@/lib/scheduling/booking-fields";
import { eventPublicUrl, publicBaseUrl } from "@/lib/scheduling/public-url";
import { EventEditorView } from "@/components/scheduling/event-editor/event-editor-view";
import { isEditorSection } from "@/lib/scheduling/editor-sections";

export const dynamic = "force-dynamic";

/** Editor de un evento (F18 a F22). */
export default async function AgendaEventoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ seccion?: string; creado?: string }>;
}) {
  const ctx = await getPermissionContext();
  const { id } = await params;
  const query = await searchParams;

  const row = await getEventType(ctx.supabase, id);
  if (!row || row.workspace_id !== ctx.workspace.id) notFound();
  if (row.owner_user_id !== ctx.user.id && !ctx.can("scheduling.manage_others")) redirect("/dashboard/agenda/configuracion/eventos");

  const [categories, profile, schedules, calendars, connections, flows] = await Promise.all([
    listCategories(ctx.supabase, ctx.workspace.id),
    getProfileForUser(ctx.supabase, ctx.workspace.id, row.owner_user_id),
    listSchedules(ctx.supabase, ctx.workspace.id, row.owner_user_id),
    calendarsForResolve(ctx.supabase, ctx.workspace.id, row.owner_user_id),
    listCalendarConnections(ctx.supabase, ctx.workspace.id, row.owner_user_id),
    ctx.supabase.from("flows").select("id").eq("event_type_id", row.id).eq("status", "published"),
  ]);

  const profileResolved = resolveEventCalendars({}, profile ? { default_destination_calendar_id: profile.default_destination_calendar_id } : null, calendars);
  const eventResolved = resolveEventCalendars(
    { destination_calendar_id: row.destination_calendar_id, conflict_calendar_ids: row.conflict_calendar_ids },
    profile ? { default_destination_calendar_id: profile.default_destination_calendar_id } : null,
    calendars,
  );

  const schedule = row.schedule_id ? schedules.find((s) => s.id === row.schedule_id) : schedules.find((s) => s.is_default);
  const event = toEventType(row);
  const checklist = activationChecklist(event, {
    scheduleName: schedule?.name ?? null,
    destinationCalendar: eventResolved.destination
      ? { name: eventResolved.destination.name, provider: "google", writable: eventResolved.destination.access_role === "owner" || eventResolved.destination.access_role === "writer" }
      : null,
    formValid: validateBookingFields(row.booking_fields).ok,
    enabledFlows: (flows.data ?? []).length,
  });

  const base = publicBaseUrl(ctx.workspace as { scheduling_public_base_url?: string | null });
  const username = profile?.username ?? "";
  const accountOf = new Map(connections.map((c) => [c.id, c.account_label ?? "Cuenta de Google"]));
  const calendarRows = await ctx.supabase
    .from("calendars")
    .select("id, connection_id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", row.owner_user_id);
  const connectionOf = new Map((calendarRows.data ?? []).map((c) => [c.id, c.connection_id]));

  const section: EditorSection = isEditorSection(query.seccion) ? query.seccion : "details";

  return (
    <EventEditorView
      event={{ ...event, workspace_id: row.workspace_id }}
      section={section}
      categories={categories.map(toCategoryRow)}
      schedules={schedules.map(toSchedule).map((s) => ({ id: s.id, name: s.name, isDefault: s.is_default, weeklyHours: s.weekly_hours, timezone: s.timezone }))}
      calendars={calendars
        .filter((c) => c.is_active)
        .map((c) => ({
          id: c.id,
          name: c.name,
          account: accountOf.get(connectionOf.get(c.id) ?? "") ?? "Google",
          writable: c.access_role === "owner" || c.access_role === "writer",
          checkConflicts: c.check_conflicts,
        }))}
      profileDefaults={{
        scheduleName: schedules.find((s) => s.is_default)?.name ?? null,
        destinationName: profileResolved.destination?.name ?? null,
        conflictCount: profileResolved.conflicts.length,
        warnings: eventResolved.warnings,
      }}
      checklist={checklist}
      canActivate={canActivate(checklist).ok}
      previewUrl={eventPublicUrl(base, username, row.slug)}
      publicPrefix={`${base}/calendario/${username}/`}
      flowsCreated={query.creado !== undefined ? Number(query.creado) || 0 : null}
    />
  );
}
