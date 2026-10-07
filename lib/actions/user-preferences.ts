"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone } from "@/lib/timezone";

/**
 * La detecta `components/timezone-bootstrap.tsx` del navegador, en el primer
 * ingreso. `insert` (no `upsert`): si ya existe una fila, no la toca — una
 * zona guardada, sea detectada o puesta a mano, nunca se pisa sola. El
 * choque con el unico de `user_id` (23505) es el camino esperado y se
 * ignora en silencio.
 */
export async function saveDetectedTimezone(timezone: string) {
  if (!isValidTimeZone(timezone)) return { ok: false as const };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const };

  const { error } = await supabase
    .from("user_preferences")
    .insert({ user_id: user.id, timezone, timezone_source: "browser" });

  // 23505 = unique_violation: alguien (otra pestaña, otro request) ya la
  // habia guardado entre que se pidio la pagina y que esto corrio. No es un
  // error real.
  if (error && error.code !== "23505") {
    console.error("[user-preferences] no pude guardar la zona detectada:", error.message);
    return { ok: false as const };
  }

  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Cambio a mano, desde el menu de perfil. */
export async function setViewerTimezone(timezone: string) {
  if (!isValidTimeZone(timezone)) {
    return { ok: false as const, error: "Esa zona horaria no es válida" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "No autenticado" };

  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: user.id, timezone, timezone_source: "manual" }, { onConflict: "user_id" });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true as const };
}
