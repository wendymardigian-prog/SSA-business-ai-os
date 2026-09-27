/**
 * Calendarios y cuentas de Google de una persona (F5). Solo servidor.
 *
 * `syncCalendars` es lo que se llama al volver del OAuth y al "Reconectar":
 * lee calendarList.list y aplica el plan puro de `lib/scheduling/calendars`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { listCalendars, type GoogleCalendarItem } from "@/lib/google-calendar/client";
import type { GoogleDeps } from "@/lib/google-calendar/auth";
import { planCalendarSync, suggestDefaultDestination, type CalendarRow } from "@/lib/scheduling/calendars";
import { deleteSecret, oauthSecretName } from "@/lib/vault";

type Db = SupabaseClient<Database>;

export type CalendarDbRow = Database["public"]["Tables"]["calendars"]["Row"];
export type CalendarConnectionRow = Pick<
  Database["public"]["Tables"]["oauth_connections"]["Row"],
  "id" | "workspace_id" | "user_id" | "status" | "granted_scopes" | "account_label" | "last_error" | "external_account_id" | "vault_secret_prefix" | "created_at"
>;

export async function listCalendarConnections(supabase: Db, workspaceId: string, userId: string): Promise<CalendarConnectionRow[]> {
  const { data } = await supabase
    .from("oauth_connections")
    .select("id, workspace_id, user_id, status, granted_scopes, account_label, last_error, external_account_id, vault_secret_prefix, created_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "google_calendar")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return (data ?? []) as CalendarConnectionRow[];
}

export async function listUserCalendars(supabase: Db, workspaceId: string, userId: string): Promise<CalendarDbRow[]> {
  const { data } = await supabase
    .from("calendars")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true });
  return (data ?? []) as CalendarDbRow[];
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deactivated: number;
  /** true si se puso el calendario destino por defecto del perfil. */
  destinationSet: boolean;
}

/**
 * Sincroniza los calendarios de una conexion con Google.
 *
 * `items` permite pasar la lista ya leida (tests y el retorno del OAuth, que
 * la puede tener a mano); si no viene, se pide a Google.
 */
export async function syncCalendars(
  deps: GoogleDeps,
  connectionId: string,
  items?: GoogleCalendarItem[],
): Promise<SyncResult> {
  const { supabase } = deps;
  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("id, workspace_id, user_id")
    .eq("id", connectionId)
    .maybeSingle();
  if (!connection || !connection.user_id) throw new Error("La conexion no existe o no es de una persona");

  const fromGoogle = items ?? (await listCalendars(deps, connectionId));

  const { data: existingRows } = await supabase
    .from("calendars")
    .select("id, external_calendar_id, name, color, access_role, is_primary, check_conflicts, is_active")
    .eq("connection_id", connectionId);
  const existing = (existingRows ?? []) as CalendarRow[];

  const plan = planCalendarSync(existing, fromGoogle);

  if (plan.inserts.length > 0) {
    const { error } = await supabase.from("calendars").insert(
      plan.inserts.map((row) => ({
        ...row,
        workspace_id: connection.workspace_id,
        connection_id: connectionId,
        user_id: connection.user_id!,
      })),
    );
    if (error) throw new Error(`No pude guardar los calendarios: ${error.message}`);
  }
  for (const u of plan.updates) {
    await supabase.from("calendars").update(u.patch).eq("id", u.id);
  }
  if (plan.deactivate.length > 0) {
    await supabase.from("calendars").update({ is_active: false, check_conflicts: false }).in("id", plan.deactivate);
  }

  // Default del perfil: si no tiene destino, el primario escribible de su
  // primera cuenta (F5).
  let destinationSet = false;
  const { data: profile } = await supabase
    .from("scheduling_profiles")
    .select("id, default_destination_calendar_id")
    .eq("workspace_id", connection.workspace_id)
    .eq("user_id", connection.user_id)
    .maybeSingle();
  if (profile && !profile.default_destination_calendar_id) {
    const all = await listUserCalendars(supabase, connection.workspace_id, connection.user_id);
    const suggested = suggestDefaultDestination(all);
    if (suggested) {
      await supabase.from("scheduling_profiles").update({ default_destination_calendar_id: suggested }).eq("id", profile.id);
      destinationSet = true;
    }
  }

  return { inserted: plan.inserts.length, updated: plan.updates.length, deactivated: plan.deactivate.length, destinationSet };
}

/**
 * Desconecta una cuenta: borra los tokens de Vault, apaga sus calendarios y
 * saca las referencias que apuntaban a ellos (destino del perfil; los eventos
 * se limpian cuando exista event_types, B3). Devuelve cuantos calendarios
 * quedaron inactivos.
 */
export async function disconnectCalendarConnection(
  supabase: Db,
  connection: { id: string; workspace_id: string; user_id: string; vault_secret_prefix: string },
): Promise<{ calendars: number; destinationCleared: boolean }> {
  await Promise.all([
    deleteSecret(supabase, connection.workspace_id, oauthSecretName(connection.vault_secret_prefix, "access_token")),
    deleteSecret(supabase, connection.workspace_id, oauthSecretName(connection.vault_secret_prefix, "refresh_token")),
  ]);

  const { data: cals } = await supabase.from("calendars").select("id").eq("connection_id", connection.id);
  const ids = (cals ?? []).map((c) => c.id);
  if (ids.length > 0) {
    await supabase.from("calendars").update({ is_active: false, check_conflicts: false }).in("id", ids);
  }

  let destinationCleared = false;
  if (ids.length > 0) {
    const { data: profile } = await supabase
      .from("scheduling_profiles")
      .select("id, default_destination_calendar_id")
      .eq("workspace_id", connection.workspace_id)
      .eq("user_id", connection.user_id)
      .maybeSingle();
    if (profile?.default_destination_calendar_id && ids.includes(profile.default_destination_calendar_id)) {
      await supabase.from("scheduling_profiles").update({ default_destination_calendar_id: null }).eq("id", profile.id);
      destinationCleared = true;
    }
  }

  await supabase.from("oauth_connections").delete().eq("id", connection.id);
  return { calendars: ids.length, destinationCleared };
}
