import { cache } from "react";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { isValidTimeZone } from "@/lib/timezone";

/**
 * La zona horaria guardada de quien mira, o null si todavia no se detecto
 * ninguna (primer ingreso, antes de que `TimezoneBootstrap` la guarde).
 *
 * `cache()`: se puede llamar desde el layout y de nuevo desde una pagina en el
 * mismo render sin pegarle dos veces a la base, igual que `getWorkspace`.
 */
export const getSavedViewerTimezone = cache(async (): Promise<string | null> => {
  // El mismo usuario y cliente que ya resolvio `getWorkspace` en este request.
  const { supabase, user } = await getAuthUser();
  if (!user) return null;

  const { data } = await supabase
    .from("user_preferences")
    .select("timezone")
    .eq("user_id", user.id)
    .maybeSingle();

  const tz = data?.timezone;
  return tz && isValidTimeZone(tz) ? tz : null;
});

/**
 * La zona con la que se muestra, filtra y agrupa todo lo que ve ESTA persona
 * (bandeja, dashboards, costos del agente, fechas de contactos...).
 *
 * En orden: su preferencia guardada: si todavia no hay ninguna (se esta
 * deteciendo recien ahora, en este mismo request), la zona del negocio; si
 * ni eso, UTC. Nunca null: todo el codigo que llama a esto puede asumir un
 * string valido.
 */
export async function resolveViewerTimezone(workspaceTimezone?: string | null): Promise<string> {
  const saved = await getSavedViewerTimezone();
  if (saved) return saved;
  if (workspaceTimezone && isValidTimeZone(workspaceTimezone)) return workspaceTimezone;
  return "UTC";
}
