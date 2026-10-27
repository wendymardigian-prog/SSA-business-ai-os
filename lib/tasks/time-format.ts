/**
 * El formato de hora de una persona (12 h / 24 h) para mostrar la hora de las tareas (R6). No es una preferencia general
 * del sistema: vive en el perfil de agenda (`scheduling_profiles.time_format`, por persona y workspace). Sin perfil, 24 h.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { TimeFormat } from "@/lib/calendar/time";

export function asTimeFormat(value: unknown): TimeFormat {
  return value === "12h" ? "12h" : "24h";
}

export async function loadTimeFormat(db: SupabaseClient<Database>, workspaceId: string, userId: string): Promise<TimeFormat> {
  try {
    const { data } = await db.from("scheduling_profiles").select("time_format").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
    return asTimeFormat((data as { time_format?: string } | null)?.time_format);
  } catch {
    return "24h";
  }
}
