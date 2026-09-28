/**
 * Las variables `booking.*` en el contexto de un flow (F47). Solo servidor.
 *
 * Se arman una vez por evento y valen para todos los flujos que ese evento
 * dispare. Se guardan en `variables` de la sesión, que es lo ÚNICO que
 * sobrevive a un Delay: si el flujo espera dos horas y después manda el
 * mensaje, las variables tienen que seguir ahí.
 *
 * `trigger_scope: "booking"` es la marca de "este flujo arrancó por la
 * agenda". La usa `send_email` para mandar igual aunque el contacto esté
 * marcado "no contactar": una confirmación de una reunión que la persona
 * pidió no es una comunicación comercial.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { Booking } from "../types";
import { bookingVariables, emptyBookingVariables } from "./variables";
import { publicBaseUrl } from "../public-url";

type Db = SupabaseClient<Database>;

export const BOOKING_TRIGGER_SCOPE = "booking";

/**
 * Las variables de una agenda, listas para el contexto del flow.
 *
 * Devuelve `{}` si la fila no alcanza para armarlas: mejor que el mensaje
 * muestre el texto sin la variable a que muestre `{{booking.start_invitee}}`.
 */
export async function bookingContextVariables(supabase: Db, booking: Record<string, unknown>): Promise<Record<string, unknown>> {
  const workspaceId = String(booking.workspace_id ?? "");
  const eventTypeId = String(booking.event_type_id ?? "");
  const hostUserId = String(booking.host_user_id ?? "");
  if (!workspaceId || !eventTypeId) return {};

  const [{ data: event }, { data: profile }, { data: workspace }] = await Promise.all([
    supabase.from("event_types").select("title, duration_minutes").eq("id", eventTypeId).maybeSingle(),
    supabase.from("scheduling_profiles").select("display_name, timezone, username").eq("workspace_id", workspaceId).eq("user_id", hostUserId).maybeSingle(),
    supabase.from("workspaces").select("scheduling_public_base_url, timezone").eq("id", workspaceId).maybeSingle(),
  ]);
  if (!event) return {};

  const baseUrl = publicBaseUrl(workspace as { scheduling_public_base_url?: string | null } | null);
  const vars = bookingVariables(
    booking as unknown as Booking,
    { title: event.title, duration_minutes: event.duration_minutes },
    {
      name: profile?.display_name ?? "El equipo",
      timezone: profile?.timezone ?? (workspace as { timezone?: string } | null)?.timezone ?? "UTC",
    },
    { baseUrl },
  );

  return { booking: vars, trigger_scope: BOOKING_TRIGGER_SCOPE };
}

/** Las variables vacías, para que un flujo sin agenda no muestre `{{…}}`. */
export function emptyBookingContext(): Record<string, unknown> {
  return { booking: emptyBookingVariables() };
}
