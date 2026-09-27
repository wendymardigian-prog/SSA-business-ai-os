/**
 * Las cuentas de Google de la persona que piden reconectar (F7), para el
 * aviso fijo de las pantallas de Agenda. Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export async function brokenCalendarAccounts(supabase: SupabaseClient<Database>, workspaceId: string, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("oauth_connections")
    .select("account_label, status")
    .eq("workspace_id", workspaceId)
    .eq("provider", "google_calendar")
    .eq("user_id", userId)
    .in("status", ["revoked", "error"]);
  return (data ?? []).map((c) => c.account_label ?? "cuenta de Google");
}
