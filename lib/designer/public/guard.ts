/**
 * Las defensas del link público `/d/<código>` (F43): tope por IP y un 404 que no delata nada por el tiempo.
 *
 * - **Tope por IP**: 120 pedidos por minuto a la página, a la tarjeta y a la descarga; las imágenes de una
 *   pieza (una por página, hasta 20) tienen su propio tope más alto, para que ver una pieza de varias páginas
 *   no gaste el de la página. La IP sale de `clientIp` (nunca del `X-Forwarded-For` que elige el cliente) y
 *   solo se guarda hasheada (`hashIp`).
 * - **Un código inexistente tarda parecido a uno que existe**: no se debe poder separar "este código no existe"
 *   de "este es un borrador" por cuánto demora la respuesta. El 404 espera hasta un mínimo antes de salir.
 *
 * Solo servidor (usa el cliente de servicio para el tope).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { clientIp, hashIp } from "@/lib/scheduling/antispam";
import type { Database } from "@/lib/types/database";

export type PublicScope = "page" | "image" | "download" | "preview";

/** Pedidos por minuto y por IP de cada parte del link. */
export const PUBLIC_LIMITS: Record<PublicScope, number> = { page: 120, image: 600, download: 120, preview: 120 };

const WINDOW_MS = 60_000;

/** Cuenta este pedido y dice si pasó el tope. Un error de base NO bloquea (lo decide `checkLimit`). */
export async function withinPublicLimit(service: SupabaseClient<Database>, headers: Headers, scope: PublicScope): Promise<boolean> {
  const result = await checkLimit(service, { key: `designer:${scope}:${hashIp(clientIp(headers))}`, max: PUBLIC_LIMITS[scope], windowMs: WINDOW_MS });
  return result.allowed;
}

/** Lo que tarda como mínimo un 404 (ms): lo que tarda una página existente en leer lo suyo. */
export const NOT_FOUND_MIN_MS = 150;

/** El instante en que empieza a medirse un pedido (para emparejar el 404). */
export function startClock(): number {
  return Date.now();
}

/** Cuánto falta esperar para llegar al mínimo (nunca negativo). */
export function remainingDelay(elapsedMs: number, minMs: number = NOT_FOUND_MIN_MS): number {
  return Math.max(0, Math.ceil(minMs - Math.max(0, elapsedMs)));
}

/** Espera hasta completar el mínimo desde `startedAt`. `sleep` y `now` se inyectan en los tests. */
export async function padNotFound(
  startedAt: number,
  deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const wait = remainingDelay(now() - startedAt);
  if (wait > 0) await sleep(wait);
}

/** Un 404 sin cuerpo con el tiempo emparejado y sin caché. */
export async function notFoundResponse(startedAt: number): Promise<Response> {
  await padNotFound(startedAt);
  return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
}

export function tooManyResponse(): Response {
  return new Response("Demasiados pedidos. Probá de nuevo en un minuto.", {
    status: 429,
    headers: { "Retry-After": "60", "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}
