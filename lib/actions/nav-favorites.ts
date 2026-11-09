"use server";

import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone } from "@/lib/timezone";
import { COLLAPSIBLE_GROUPS, isFavoriteCandidate, parseNavFavorites, type NavFavorites, type NavGroupId } from "@/lib/nav/items";
import type { Json } from "@/lib/types/database";

type Result = { ok: true; favorites: NavFavorites } | { ok: false; error: string };

const FAILED = "No pude guardar la favorita. Probá de nuevo.";

/**
 * Marca (o saca, con `href: null`) la pantalla favorita de una seccion del menu.
 *
 * La persona sale SIEMPRE de la sesion. El grupo tiene que ser una seccion colapsable y el href un item
 * de ESA seccion (lista blanca de `NAV_ITEMS`): nunca se guarda una URL libre. No pide permisos: es una
 * preferencia propia, y una favorita que la persona no ve se ignora al dibujar el menu.
 *
 * Sin fila de `user_preferences` todavia (primer ingreso), la crea con la zona del navegador, igual que
 * los avisos (`lib/actions/account.ts`): sin una zona valida no la crea.
 */
export async function setNavFavorite(input: { group: string; href: string | null; browserTimezone?: string }): Promise<Result> {
  if (!COLLAPSIBLE_GROUPS.includes(input.group as NavGroupId)) return { ok: false, error: "Esa sección no existe." };
  if (input.href !== null && !isFavoriteCandidate(input.group, input.href)) return { ok: false, error: "Esa pantalla no es de esta sección." };

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };
  const userId = auth.user.id;

  const { data: row, error: readError } = await supabase.from("user_preferences").select("nav_favorites").eq("user_id", userId).maybeSingle();
  if (readError) {
    console.error("[menu] no pude leer las favoritas:", readError.message);
    return { ok: false, error: FAILED };
  }

  const next: NavFavorites = { ...parseNavFavorites(row?.nav_favorites) };
  const group = input.group as NavGroupId;
  if (input.href === null) delete next[group];
  else next[group] = input.href;
  const value = next as unknown as Json;

  if (row) {
    const { error } = await supabase.from("user_preferences").update({ nav_favorites: value }).eq("user_id", userId);
    if (error) {
      console.error("[menu] no pude guardar la favorita:", error.message);
      return { ok: false, error: FAILED };
    }
    return { ok: true, favorites: next };
  }

  if (!input.browserTimezone || !isValidTimeZone(input.browserTimezone)) return { ok: false, error: FAILED };
  const { error } = await supabase
    .from("user_preferences")
    .insert({ user_id: userId, timezone: input.browserTimezone, timezone_source: "browser", nav_favorites: value });
  if (error?.code === "23505") {
    // La fila aparecio entre la lectura y esto (el arranque guardo la zona): se guarda como cambio.
    const { error: updateError } = await supabase.from("user_preferences").update({ nav_favorites: value }).eq("user_id", userId);
    if (updateError) {
      console.error("[menu] no pude guardar la favorita:", updateError.message);
      return { ok: false, error: FAILED };
    }
    return { ok: true, favorites: next };
  }
  if (error) {
    console.error("[menu] no pude crear las preferencias:", error.message);
    return { ok: false, error: FAILED };
  }
  return { ok: true, favorites: next };
}
