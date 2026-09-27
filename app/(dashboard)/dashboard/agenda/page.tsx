import { redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { canOpenConfig } from "@/lib/scheduling/config-sections";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { brokenCalendarAccounts } from "@/lib/scheduling/data/attention";
import { AgendaHomeView } from "@/components/scheduling/agenda-home-view";

export const dynamic = "force-dynamic";

/**
 * Agenda (F8, F33): abre directo las agendas, sin pestañas. La lista, el
 * kanban y el calendario llegan en el Bloque 5; hasta entonces la pantalla
 * tiene la barra, el engranaje y el vacio con acciones.
 */
export default async function AgendaPage() {
  const ctx = await getPermissionContext();
  if (!ctx.can("scheduling.use") && !ctx.can("bookings.view")) redirect("/dashboard");

  const [profile, broken] = await Promise.all([
    ctx.can("scheduling.use") ? getProfileForUser(ctx.supabase, ctx.workspace.id, ctx.user.id) : Promise.resolve(null),
    ctx.can("scheduling.use") ? brokenCalendarAccounts(ctx.supabase, ctx.workspace.id, ctx.user.id) : Promise.resolve([]),
  ]);

  return (
    <AgendaHomeView
      showConfig={canOpenConfig(ctx.can)}
      needsProfile={ctx.can("scheduling.use") && !profile}
      brokenAccounts={broken}
      viewerTimezone={profile?.timezone ?? ((ctx.workspace as { timezone?: string }).timezone ?? "America/Costa_Rica")}
      scopeAll={ctx.scope("bookings") === "all"}
    />
  );
}
