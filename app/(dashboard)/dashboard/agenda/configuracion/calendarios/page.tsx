import { getPermissionContext } from "@/lib/auth/guards";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { listCalendarConnections, listUserCalendars } from "@/lib/scheduling/data/calendars";
import { calendarConnectionStatus } from "@/lib/scheduling/bookable";
import { CalendarsView } from "@/components/scheduling/calendars-view";
import { OAUTH_ERROR_MESSAGES, type OAuthErrorCode } from "@/lib/oauth/flow";

export const dynamic = "force-dynamic";

/**
 * Configuracion de agenda > Calendarios de Google (F5). Solo las cuentas de
 * la propia persona: nadie ve ni toca las de otra (§5).
 */
export default async function AgendaCalendariosPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const ctx = await getPermissionContext();
  const params = await searchParams;
  const [profile, connections, calendars] = await Promise.all([
    getProfileForUser(ctx.supabase, ctx.workspace.id, ctx.user.id),
    listCalendarConnections(ctx.supabase, ctx.workspace.id, ctx.user.id),
    listUserCalendars(ctx.supabase, ctx.workspace.id, ctx.user.id),
  ]);

  const flash = params.connected
    ? { tone: "success" as const, text: "Cuenta de Google conectada. Elegí en qué calendarios se revisan conflictos." }
    : params.error
      ? { tone: "error" as const, text: OAUTH_ERROR_MESSAGES[params.error as OAuthErrorCode] ?? "No se pudo conectar la cuenta." }
      : null;

  return (
    <CalendarsView
      canUse={ctx.can("scheduling.use")}
      hasProfile={Boolean(profile)}
      defaultDestinationId={profile?.default_destination_calendar_id ?? null}
      accounts={connections.map((c) => ({
        id: c.id,
        label: c.account_label ?? "Cuenta de Google",
        status: calendarConnectionStatus({ id: c.id, status: c.status, granted_scopes: c.granted_scopes }),
        lastError: c.last_error,
        calendars: calendars
          .filter((k) => k.connection_id === c.id)
          .map((k) => ({ id: k.id, name: k.name, color: k.color, accessRole: k.access_role, isPrimary: k.is_primary, checkConflicts: k.check_conflicts, isActive: k.is_active })),
      }))}
      flash={flash}
    />
  );
}
