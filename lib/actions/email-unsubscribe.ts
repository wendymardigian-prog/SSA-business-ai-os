"use server";

import { headers } from "next/headers";
import { clientIp } from "@/lib/scheduling/antispam";
import { createServiceClient } from "@/lib/supabase/server";
import { applyUnsubscribeAction, type UnsubscribePageResult } from "@/lib/email/unsubscribe-public";

/**
 * Los botones de la pagina publica `/baja/<token>` (suscripcion a emails, E3). Sin sesion: lo que autoriza es el token
 * (opaco, del email que recibio la persona). Tope por IP. Nunca devuelven datos del contacto mas alla de la direccion
 * enmascarada.
 */

const MESSAGES = {
  not_found: "Este link de baja no es válido.",
  rate_limited: "Demasiados intentos. Probá de nuevo en un minuto.",
  error: "No pudimos guardar el cambio. Probá de nuevo en un rato.",
} as const;

async function run(token: string, action: "unsubscribe" | "resubscribe"): Promise<UnsubscribePageResult> {
  const service = await createServiceClient();
  const outcome = await applyUnsubscribeAction(service, {
    token: typeof token === "string" ? token : "",
    ip: clientIp(await headers()),
    action,
    source: "unsubscribe_page",
  });
  return outcome.ok ? { ok: true, view: outcome.view } : { ok: false, error: MESSAGES[outcome.reason] };
}

/** "Darme de baja". */
export async function confirmUnsubscribe(token: string): Promise<UnsubscribePageResult> {
  return run(token, "unsubscribe");
}

/** "Me equivoqué, volver a suscribirme". No se puede desde un rebote o una queja (lo decide la base). */
export async function resubscribe(token: string): Promise<UnsubscribePageResult> {
  return run(token, "resubscribe");
}
