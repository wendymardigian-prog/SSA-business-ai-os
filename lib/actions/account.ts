"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isOwnAvatarPath, userAvatarPath, userAvatarPublicUrl, USER_AVATARS_BUCKET } from "@/lib/account/avatar";
import { effectiveWhatsApp, parseAvatarDataUrl, parseContactInput, parseDisplayName, parsePasswordChange } from "@/lib/account/validation";
import { getWorkspace } from "@/lib/workspace";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { sendTeamWhatsApp } from "@/lib/notifications/team-whatsapp";
import {
  eventByKey,
  NOTIFICATION_CHANNELS,
  parseStoredPrefs,
  withPref,
  type NotificationChannel,
  type StoredPrefs,
} from "@/lib/notifications/preferences";
import { isValidTimeZone } from "@/lib/timezone";
import type { Json } from "@/lib/types/database";

/**
 * Mi cuenta → Perfil (00273). Cada accion es de la PERSONA logueada: el
 * usuario sale SIEMPRE de la sesion, nunca de lo que manda el navegador, y
 * nada de esto pide un permiso del workspace.
 *
 * - El nombre vive en `auth.users.user_metadata.full_name` (lo leen todos).
 * - Foto, telefono y WhatsApp en `user_profiles`, con el cliente de la sesion
 *   (la RLS deja tocar solo la fila propia). La foto la sube el service role:
 *   el bucket no tiene policies de escritura.
 * - Nunca se loguea una contraseña, un telefono ni un email.
 */

type Result = { ok: true } | { ok: false; error: string };

async function sessionUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

const NO_SESSION = "Tu sesión venció. Volvé a entrar.";

/** Cambia el nombre que ve todo el equipo. */
export async function updateMyName(input: { name: string }): Promise<Result> {
  const parsed = parseDisplayName(input.name);
  if (!parsed.ok) return parsed;

  const ctx = await sessionUser();
  if (!ctx) return { ok: false, error: NO_SESSION };

  // `data` se MEZCLA con el user_metadata que ya habia (no se pierde invite_id).
  const { error } = await ctx.supabase.auth.updateUser({ data: { full_name: parsed.value } });
  if (error) {
    console.error("[cuenta] no pude cambiar el nombre:", error.message);
    return { ok: false, error: "No pude guardar el nombre. Probá de nuevo." };
  }

  // El panel lee el nombre del token (getAuthUser): sin renovarlo, el menu
  // seguiria mostrando el viejo hasta una hora. Si falla, se ve al renovarse.
  const { error: refreshError } = await ctx.supabase.auth.refreshSession();
  if (refreshError) console.warn("[cuenta] no pude renovar la sesion despues del nombre:", refreshError.message);

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Telefono y WhatsApp. */
export async function updateMyContact(input: {
  phone: string;
  whatsappPhone: string;
  sameAsPhone: boolean;
}): Promise<{ ok: true; phone: string | null; whatsappPhone: string | null } | { ok: false; error: string }> {
  const parsed = parseContactInput(input);
  if (!parsed.ok) return parsed;

  const ctx = await sessionUser();
  if (!ctx) return { ok: false, error: NO_SESSION };

  const { error } = await ctx.supabase
    .from("user_profiles")
    .upsert({ user_id: ctx.user.id, ...parsed.value }, { onConflict: "user_id" });
  if (error) {
    console.error("[cuenta] no pude guardar los datos de contacto:", error.message);
    return { ok: false, error: "No pude guardar tus datos. Probá de nuevo." };
  }

  revalidatePath("/dashboard/cuenta");
  return { ok: true, phone: parsed.value.phone, whatsappPhone: parsed.value.whatsapp_phone };
}

/** Sube una foto nueva (data URL ya recortada por la pantalla, validada por sus bytes). */
export async function uploadMyAvatar(input: {
  dataUrl: string;
}): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const parsed = parseAvatarDataUrl(input.dataUrl);
  if (!parsed.ok) return parsed;

  const ctx = await sessionUser();
  if (!ctx) return { ok: false, error: NO_SESSION };
  const userId = ctx.user.id;

  const { data: before } = await ctx.supabase.from("user_profiles").select("avatar_path").eq("user_id", userId).maybeSingle();

  const service = await createServiceClient();
  const path = userAvatarPath(userId, randomUUID(), parsed.ext);
  const { error: uploadError } = await service.storage
    .from(USER_AVATARS_BUCKET)
    .upload(path, parsed.bytes, { contentType: parsed.mime, upsert: false, cacheControl: "31536000" });
  if (uploadError) {
    console.error("[cuenta] no pude subir la foto:", uploadError.message);
    return { ok: false, error: "No pude subir la foto. Probá de nuevo." };
  }

  const { error } = await ctx.supabase
    .from("user_profiles")
    .upsert({ user_id: userId, avatar_path: path }, { onConflict: "user_id" });
  if (error) {
    console.error("[cuenta] no pude guardar la foto:", error.message);
    await removeAvatarFile(userId, path);
    return { ok: false, error: "No pude guardar la foto. Probá de nuevo." };
  }

  // La anterior ya no la usa nadie (si falla el borrado, queda un archivo suelto; nada se rompe).
  await removeAvatarFile(userId, before?.avatar_path);

  revalidatePath("/dashboard", "layout");
  return { ok: true, url: userAvatarPublicUrl(path) };
}

/** Saca la foto: vuelven las iniciales. */
export async function removeMyAvatar(): Promise<Result> {
  const ctx = await sessionUser();
  if (!ctx) return { ok: false, error: NO_SESSION };
  const userId = ctx.user.id;

  const { data: before } = await ctx.supabase.from("user_profiles").select("avatar_path").eq("user_id", userId).maybeSingle();
  if (!before?.avatar_path) return { ok: true };

  const { error } = await ctx.supabase.from("user_profiles").update({ avatar_path: null }).eq("user_id", userId);
  if (error) {
    console.error("[cuenta] no pude sacar la foto:", error.message);
    return { ok: false, error: "No pude sacar la foto. Probá de nuevo." };
  }

  await removeAvatarFile(userId, before.avatar_path);
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

async function removeAvatarFile(userId: string, path: string | null | undefined) {
  if (!isOwnAvatarPath(userId, path)) return;
  try {
    const service = await createServiceClient();
    const { error } = await service.storage.from(USER_AVATARS_BUCKET).remove([path]);
    if (error) console.warn("[cuenta] no pude borrar la foto anterior:", error.message);
  } catch (err) {
    console.warn("[cuenta] no pude borrar la foto anterior:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Cambia la contraseña, pidiendo la actual.
 *
 * La actual se comprueba entrando con ella en una sesion aparte (sin cookies),
 * y la nueva se pone con ESA sesion: recien iniciada, cumple con la regla de
 * Supabase que pide haber entrado hace poco para cambiar la contraseña. Despues
 * esa sesion aparte se cierra; la del navegador sigue igual.
 */
export async function changeMyPassword(input: { current: string; next: string; confirm: string }): Promise<Result> {
  const parsed = parsePasswordChange(input);
  if (!parsed.ok) return parsed;

  const ctx = await sessionUser();
  if (!ctx) return { ok: false, error: NO_SESSION };
  const email = ctx.user.email;
  if (!email) return { ok: false, error: "Tu cuenta no tiene email: pedile a un Admin que te ayude." };

  const temp = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: signIn, error: signInError } = await temp.auth.signInWithPassword({ email, password: parsed.value.current });
  if (signInError || !signIn.user) {
    // 429: demasiados intentos. Cualquier otro: la contraseña no es la correcta.
    if (signInError?.status === 429) return { ok: false, error: "Hiciste muchos intentos. Esperá unos minutos y probá de nuevo." };
    return { ok: false, error: "La contraseña actual no es correcta." };
  }
  // Por las dudas: que la sesion aparte sea de la misma persona.
  if (signIn.user.id !== ctx.user.id) {
    await temp.auth.signOut({ scope: "local" });
    return { ok: false, error: "La contraseña actual no es correcta." };
  }

  const { error } = await temp.auth.updateUser({ password: parsed.value.next });
  await temp.auth.signOut({ scope: "local" }).catch(() => undefined);

  if (error) {
    console.error("[cuenta] no pude cambiar la contraseña:", error.status ?? "", error.code ?? "");
    if (error.code === "weak_password") return { ok: false, error: "Esa contraseña es muy fácil de adivinar: probá con otra más larga." };
    if (error.code === "same_password") return { ok: false, error: "La nueva contraseña tiene que ser distinta de la actual" };
    return { ok: false, error: "No pude cambiar la contraseña. Probá de nuevo." };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notificaciones (00274)
// ---------------------------------------------------------------------------

/**
 * Prende o apaga UN canal de UN evento. La pantalla los manda de a uno y en
 * orden (cola serial), asi que leer-mezclar-escribir alcanza.
 *
 * `browserTimezone`: si la persona todavia no tiene fila en user_preferences
 * (la zona se guarda sola en el primer ingreso), se crea con la zona del
 * navegador, como la hubiera creado el arranque.
 */
export async function setNotificationPref(input: {
  eventKey: string;
  channel: string;
  value: boolean;
  browserTimezone?: string;
}): Promise<{ ok: true; prefs: StoredPrefs } | { ok: false; error: string }> {
  const event = eventByKey(input.eventKey);
  if (!event) return { ok: false, error: "Ese aviso no existe." };
  if (!(NOTIFICATION_CHANNELS as readonly string[]).includes(input.channel)) return { ok: false, error: "Ese canal no existe." };
  if (typeof input.value !== "boolean") return { ok: false, error: "Valor inválido." };

  const ctx = await sessionUser();
  if (!ctx) return { ok: false, error: NO_SESSION };

  const { data: row, error: readError } = await ctx.supabase
    .from("user_preferences")
    .select("notification_prefs")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (readError) {
    console.error("[avisos] no pude leer las preferencias:", readError.message);
    return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };
  }

  const next = withPref(parseStoredPrefs(row?.notification_prefs), event.key, input.channel as NotificationChannel, input.value);
  const saved = await writePrefs(ctx, next, Boolean(row), input.browserTimezone);
  if (!saved) return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };

  revalidatePath("/dashboard", "layout");
  return { ok: true, prefs: next };
}

/** Vuelve todos los avisos a los valores por defecto. */
export async function resetNotificationPrefs(input: { browserTimezone?: string } = {}): Promise<Result> {
  const ctx = await sessionUser();
  if (!ctx) return { ok: false, error: NO_SESSION };
  const { data: row } = await ctx.supabase.from("user_preferences").select("user_id").eq("user_id", ctx.user.id).maybeSingle();
  const saved = await writePrefs(ctx, {}, Boolean(row), input.browserTimezone);
  if (!saved) return { ok: false, error: "No pude restablecer los avisos. Probá de nuevo." };
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

async function writePrefs(
  ctx: NonNullable<Awaited<ReturnType<typeof sessionUser>>>,
  prefs: StoredPrefs,
  exists: boolean,
  browserTimezone: string | undefined,
): Promise<boolean> {
  const value = prefs as unknown as Json;
  if (exists) {
    const { error } = await ctx.supabase.from("user_preferences").update({ notification_prefs: value }).eq("user_id", ctx.user.id);
    if (error) console.error("[avisos] no pude guardar las preferencias:", error.message);
    return !error;
  }
  const timezone = browserTimezone && isValidTimeZone(browserTimezone) ? browserTimezone : "UTC";
  const { error } = await ctx.supabase
    .from("user_preferences")
    .insert({ user_id: ctx.user.id, timezone, timezone_source: "browser", notification_prefs: value });
  // 23505: la fila aparecio entre la lectura y esto (el arranque guardo la zona). Se reintenta como update.
  if (error?.code === "23505") return writePrefs(ctx, prefs, true, browserTimezone);
  if (error) console.error("[avisos] no pude crear las preferencias:", error.message);
  return !error;
}

/**
 * "Mandarme un WhatsApp de prueba": desde el WhatsApp de avisos del negocio
 * al numero de la persona. Tres por hora.
 */
export async function sendMyTestWhatsApp(): Promise<Result> {
  const { user, workspace } = await getWorkspace();
  const ctx = await sessionUser();
  if (!ctx || ctx.user.id !== user.id) return { ok: false, error: NO_SESSION };

  const { data: profile } = await ctx.supabase
    .from("user_profiles")
    .select("phone, whatsapp_phone, whatsapp_same_as_phone")
    .eq("user_id", user.id)
    .maybeSingle();
  const number = effectiveWhatsApp(profile);
  if (!number) return { ok: false, error: "Primero guardá tu WhatsApp." };

  const service = await createServiceClient();
  const limit = await checkLimit(service, { key: `account:wa-test:${user.id}`, max: 3, windowMs: 60 * 60_000 });
  if (!limit.allowed) return { ok: false, error: "Ya mandaste tres pruebas en la última hora. Probá más tarde." };

  const businessName = workspace.brand_name?.trim() || workspace.name;
  const result = await sendTeamWhatsApp(
    service,
    workspace.id,
    number,
    `${businessName}: este es un mensaje de prueba. Así te van a llegar los avisos que elijas en Mi cuenta → Notificaciones.`,
  );
  if (!result.ok) {
    return { ok: false, error: result.reason === "failed" ? `No se pudo mandar: ${result.error} Revisá el número.` : result.error };
  }
  return { ok: true };
}
