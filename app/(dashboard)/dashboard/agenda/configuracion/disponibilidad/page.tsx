import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { googleCalendarStatesByUser } from "@/lib/scheduling/google-notice";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { listOutOfOffice, listSchedules, listUserEventTypes, toSchedule } from "@/lib/scheduling/data/schedules";
import { AvailabilityView } from "@/components/scheduling/availability/availability-view";
import { resolveViewerTimezone } from "@/lib/user-timezone";

export const dynamic = "force-dynamic";

/**
 * Configuracion de agenda > Disponibilidad (F10 a F14). Con
 * `scheduling.manage_others` se puede editar la de otra persona (`?persona=`).
 */
export default async function AgendaDisponibilidadPage({ searchParams }: { searchParams: Promise<{ horario?: string; persona?: string }> }) {
  const ctx = await getPermissionContext();
  const params = await searchParams;
  const canManageOthers = ctx.can("scheduling.manage_others");
  const targetUserId = canManageOthers && params.persona ? params.persona : ctx.user.id;
  const isSelf = targetUserId === ctx.user.id;

  // Quién tiene Google Calendar conectado: solo user_id y status, con el servidor (la RLS de las conexiones es de cada
  // persona). Las de otros, solo con scheduling.manage_others.
  const service = await createServiceClient();
  let googleQuery = service.from("oauth_connections").select("user_id, status").eq("workspace_id", ctx.workspace.id).eq("provider", "google_calendar");
  if (!canManageOthers) googleQuery = googleQuery.eq("user_id", ctx.user.id);

  const [profile, schedules, ooo, events, members, { data: googleRows }] = await Promise.all([
    getProfileForUser(ctx.supabase, ctx.workspace.id, targetUserId),
    listSchedules(ctx.supabase, ctx.workspace.id, targetUserId),
    listOutOfOffice(ctx.supabase, ctx.workspace.id, targetUserId),
    listUserEventTypes(ctx.supabase, ctx.workspace.id, targetUserId),
    canManageOthers ? getWorkspaceMembers(ctx.workspace.id) : Promise.resolve([]),
    googleQuery,
  ]);
  const googleStates = googleCalendarStatesByUser(googleRows ?? [], [ctx.user.id, ...members.map((m) => m.userId)]);

  // Las fechas se VEN en la zona de quien mira (Mi cuenta), no en la de su perfil de agenda.
  const viewerTimezone = await resolveViewerTimezone(ctx.workspace.timezone);

  return (
    <AvailabilityView
      schedules={schedules.map(toSchedule)}
      selectedId={params.horario ?? null}
      outOfOffice={ooo}
      events={events}
      viewerTimezone={viewerTimezone}
      targetUserId={targetUserId}
      isSelf={isSelf}
      canManageOthers={canManageOthers}
      members={members.map((m) => ({ userId: m.userId, label: m.name || m.email }))}
      googleStates={googleStates}
    />
  );
}
