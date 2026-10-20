/**
 * Lo que pasa con los eventos cuando una persona conecta o desconecta su
 * Google Calendar (decisión del 20/10/2026: un evento "solo en el sistema" se
 * vincula SOLO al conectar, con aviso).
 *
 * Solo servidor: escribe con el cliente de servicio después de que quien llama
 * comprobó que la cuenta es de esa persona.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createNotification } from "@/lib/notifications/create";

type Db = SupabaseClient<Database>;

/**
 * Saca de los eventos de la persona las referencias a calendarios que se
 * apagan (al desconectar una cuenta). Sin esto, un evento que había elegido su
 * propio calendario quedaba apuntando a uno muerto: no vuelve a usar el del
 * perfil, y al reconectar (que crea calendarios nuevos) tampoco se vinculaba.
 * Devuelve cuántos eventos cambió.
 */
export async function clearEventCalendarRefs(service: Db, workspaceId: string, userId: string, calendarIds: string[]): Promise<number> {
  if (calendarIds.length === 0) return 0;
  const gone = new Set(calendarIds);
  const { data, error } = await service
    .from("event_types")
    .select("id, destination_calendar_id, conflict_calendar_ids")
    .eq("workspace_id", workspaceId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null);
  if (error) throw new Error(`No pude leer los eventos: ${error.message}`);

  let changed = 0;
  for (const e of data ?? []) {
    const conflicts = e.conflict_calendar_ids ?? [];
    const keptConflicts = conflicts.filter((id) => !gone.has(id));
    const clearDestination = e.destination_calendar_id !== null && gone.has(e.destination_calendar_id);
    if (!clearDestination && keptConflicts.length === conflicts.length) continue;
    const { error: updateError } = await service
      .from("event_types")
      .update({
        ...(clearDestination ? { destination_calendar_id: null } : {}),
        ...(keptConflicts.length !== conflicts.length ? { conflict_calendar_ids: keptConflicts } : {}),
      })
      .eq("id", e.id);
    if (updateError) throw new Error(`No pude actualizar el evento: ${updateError.message}`);
    changed++;
  }
  return changed;
}

/**
 * Al conectar Google por primera vez (el perfil recibe su calendario por
 * defecto), los eventos que estaban "solo en el sistema" pasan a usarlo solos.
 * Se le avisa a la persona cuáles. Nunca lanza: el aviso no puede tumbar la
 * conexión.
 */
export async function notifyEventsNowOnGoogle(service: Db, workspaceId: string, userId: string): Promise<number> {
  try {
    const { data } = await service
      .from("event_types")
      .select("title")
      .eq("workspace_id", workspaceId)
      .eq("owner_user_id", userId)
      .is("deleted_at", null)
      .is("destination_calendar_id", null)
      .neq("status", "inactive")
      .order("title");
    const titles = (data ?? []).map((e) => e.title);
    if (titles.length === 0) return 0;
    const shown = titles.slice(0, 5).join(", ") + (titles.length > 5 ? ` y ${titles.length - 5} más` : "");
    await createNotification({
      supabase: service,
      workspaceId,
      type: "integration_attention",
      title: titles.length === 1 ? "Tu evento ya usa tu Google Calendar" : `Tus ${titles.length} eventos ya usan tu Google Calendar`,
      body: `${shown}: las reuniones nuevas se crean en tu calendario y se revisan tus otros compromisos. Las que ya estaban agendadas no se tocan.`,
      entityType: "integration",
      recipientId: userId,
      metadata: { provider: "google_calendar", cause: "events_linked", events: titles.length },
    });
    return titles.length;
  } catch (err) {
    console.error("[calendar-switch] no pude avisar los eventos vinculados", err instanceof Error ? err.message : "error");
    return 0;
  }
}
