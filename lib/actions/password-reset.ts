"use server";

import { headers } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/app-url";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { clientIp, hashIp } from "@/lib/scheduling/antispam";
import { parseNewPassword } from "@/lib/account/validation";
import { RESET_REDIRECT_PATH } from "@/lib/account/password-reset";

/**
 * "Olvidé mi contraseña" (Mi cuenta).
 *
 * 1. `requestPasswordReset`: Supabase Auth manda el email con el link. La
 *    respuesta es SIEMPRE la misma, exista o no la cuenta: la pantalla nunca
 *    dice si un email esta registrado. Tope por IP y por email.
 * 2. El link vuelve por `/auth/confirm` (token_hash, la plantilla en español)
 *    o por `/auth/callback` (el link por defecto de Supabase), que dejan una
 *    sesion de recuperacion y llevan a `/restablecer`.
 * 3. `setNewPassword`: con esa sesion, la contraseña nueva.
 *
 * Nunca se loguea el email ni la contraseña.
 */

const REQUESTS_PER_IP_PER_HOUR = 10;
const REQUESTS_PER_EMAIL_PER_HOUR = 3;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestPasswordReset(input: { email: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: "Revisá el email: no parece válido." };

  const service = await createServiceClient();
  const ip = clientIp(await headers());
  const byIp = await checkLimit(service, { key: `auth:reset:ip:${hashIp(ip)}`, max: REQUESTS_PER_IP_PER_HOUR, windowMs: 60 * 60_000 });
  if (!byIp.allowed) return { ok: false, error: "Hiciste muchos pedidos. Esperá un rato y probá de nuevo." };
  // Por email tambien: que nadie le llene la casilla a otra persona. Pasado el tope se responde igual que siempre.
  const byEmail = await checkLimit(service, { key: `auth:reset:email:${hashIp(email)}`, max: REQUESTS_PER_EMAIL_PER_HOUR, windowMs: 60 * 60_000 });
  if (!byEmail.allowed) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl()}/auth/callback?next=${encodeURIComponent(RESET_REDIRECT_PATH)}`,
  });
  if (error) {
    // Un 429 de Supabase (su limite de emails) es lo unico que vale la pena decir; el resto se responde igual.
    console.error("[recuperar] Supabase no pudo mandar el email:", error.status ?? "", error.code ?? "");
    if (error.status === 429) return { ok: false, error: "Ya se mandaron muchos emails en poco tiempo. Esperá unos minutos y probá de nuevo." };
  }
  return { ok: true };
}

export async function setNewPassword(input: { next: string; confirm: string }): Promise<{ ok: true } | { ok: false; error: string; expired?: boolean }> {
  const parsed = parseNewPassword(input.next, input.confirm);
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, expired: true, error: "El link venció o ya se usó. Pedí uno nuevo." };

  const { error } = await supabase.auth.updateUser({ password: parsed.value });
  if (error) {
    console.error("[restablecer] no pude cambiar la contraseña:", error.status ?? "", error.code ?? "");
    if (error.code === "same_password") return { ok: false, error: "La nueva contraseña tiene que ser distinta de la anterior." };
    if (error.code === "weak_password") return { ok: false, error: "Esa contraseña es muy fácil de adivinar: probá con otra más larga." };
    if (error.code === "reauthentication_needed" || error.status === 401) {
      return { ok: false, expired: true, error: "El link venció o ya se usó. Pedí uno nuevo." };
    }
    return { ok: false, error: "No pude cambiar la contraseña. Probá de nuevo." };
  }
  return { ok: true };
}
