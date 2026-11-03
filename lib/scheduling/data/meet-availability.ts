/**
 * Lee lo que hace falta para saber quien puede crear un Google Meet (ver
 * `lib/scheduling/meet-availability.ts`). Solo servidor.
 *
 * Usa el cliente de SERVICIO: la RLS de `oauth_connections` muestra las cuentas
 * ajenas solo a Owner y Admin, y quien agenda para otra persona necesita saber
 * si la de esa persona sirve. Nunca sale de aca nada mas que un si o un no.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { meetAvailableFor, type MeetCalendarRow, type MeetConnectionRow, type MeetContext } from "@/lib/scheduling/meet-availability";

type Db = SupabaseClient<Database>;

export async function loadMeetContext(service: Db, workspaceId: string, userIds: string[]): Promise<MeetContext> {
  const users = [...new Set(userIds)];
  if (users.length === 0) return { calendars: [], connections: [], defaultDestinationByUser: new Map() };
  const [{ data: calendars }, { data: connections }, { data: profiles }] = await Promise.all([
    service
      .from("calendars")
      .select("id, user_id, connection_id, name, access_role, check_conflicts, is_active")
      .eq("workspace_id", workspaceId)
      .in("user_id", users),
    service
      .from("oauth_connections")
      .select("id, user_id, status, granted_scopes")
      .eq("workspace_id", workspaceId)
      .eq("provider", "google_calendar")
      .in("user_id", users),
    service.from("scheduling_profiles").select("user_id, default_destination_calendar_id").eq("workspace_id", workspaceId).in("user_id", users),
  ]);
  return {
    calendars: (calendars ?? []) as MeetCalendarRow[],
    connections: (connections ?? []).map((c) => ({ ...c, granted_scopes: c.granted_scopes ?? [] })) as MeetConnectionRow[],
    defaultDestinationByUser: new Map((profiles ?? []).map((p) => [p.user_id, p.default_destination_calendar_id])),
  };
}

/** Una sola reunion: la comprobacion del servidor antes de pedir un Meet. */
export async function canHostCreateMeet(
  service: Db,
  workspaceId: string,
  hostUserId: string,
  eventDestinationId: string | null,
): Promise<boolean> {
  const ctx = await loadMeetContext(service, workspaceId, [hostUserId]);
  return meetAvailableFor(ctx, hostUserId, eventDestinationId);
}
