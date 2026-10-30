import { cache } from "react";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { parseStoredPrefs, type StoredPrefs } from "@/lib/notifications/preferences";

/**
 * Las preferencias de avisos de quien esta logueado (00274), con el cliente de
 * la sesion (la RLS deja leer solo la fila propia). Sin fila o sin la 00274,
 * vacio: todo con los valores por defecto.
 *
 * Solo servidor. Cacheado por request: lo piden la campana (el contador del
 * layout y la lista) y la pagina Mi cuenta.
 */
export const getMyNotificationPrefs = cache(async (): Promise<StoredPrefs> => {
  const { supabase, user } = await getAuthUser();
  if (!user) return {};
  const { data, error } = await supabase.from("user_preferences").select("notification_prefs").eq("user_id", user.id).maybeSingle();
  if (error) {
    // Una base sin la 00274 no tiene la columna: defaults, y la campana sigue andando.
    console.error("[avisos] no pude leer las preferencias:", error.message);
    return {};
  }
  return parseStoredPrefs(data?.notification_prefs);
});
