import { getPermissionContext } from "@/lib/auth/guards";
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

  const [profile, schedules, ooo, events, members] = await Promise.all([
    getProfileForUser(ctx.supabase, ctx.workspace.id, targetUserId),
    listSchedules(ctx.supabase, ctx.workspace.id, targetUserId),
    listOutOfOffice(ctx.supabase, ctx.workspace.id, targetUserId),
    listUserEventTypes(ctx.supabase, ctx.workspace.id, targetUserId),
    canManageOthers ? getWorkspaceMembers(ctx.workspace.id) : Promise.resolve([]),
  ]);

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
    />
  );
}
