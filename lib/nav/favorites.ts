import { cache } from "react";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { parseNavFavorites, type NavFavorites } from "@/lib/nav/items";

/**
 * Las pantallas favoritas del menu de quien mira (00357, `user_preferences.nav_favorites`).
 *
 * Consulta aparte de la zona horaria a proposito: si la columna todavia no existe (la migracion se
 * aplica antes o despues del codigo), esto devuelve {} y la zona sigue andando. Nunca lanza: sin
 * favoritas el menu funciona igual.
 */
export const getNavFavorites = cache(async (): Promise<NavFavorites> => {
  try {
    const { supabase, user } = await getAuthUser();
    if (!user) return {};
    const { data, error } = await supabase.from("user_preferences").select("nav_favorites").eq("user_id", user.id).maybeSingle();
    if (error) {
      console.error("[menu] no pude leer las favoritas:", error.message);
      return {};
    }
    return parseNavFavorites(data?.nav_favorites);
  } catch (err) {
    console.error("[menu] no pude leer las favoritas:", err instanceof Error ? err.message : "error desconocido");
    return {};
  }
});
