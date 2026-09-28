/**
 * Antispam de los endpoints publicos (F29): campo trampa, tope por IP y
 * atribucion.
 *
 * La IP nunca se guarda en texto: va como sha256 con sal. Sin sal propia
 * (`RATE_LIMIT_SALT`) se deriva de `CRON_SECRET`, que es un secreto que ya
 * existe y no sale de la app.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/** El campo oculto: si llega lleno, es un bot. */
export const HONEYPOT_FIELD = "website";

export const LIMITS = {
  /** Creaciones de agenda por IP y por hora. */
  create: { max: 10, windowMs: 60 * 60 * 1000 },
  /** Consultas de horarios por IP y por minuto. */
  slots: { max: 60, windowMs: 60 * 1000 },
} as const;

export type RateLimitAction = keyof typeof LIMITS;

function salt(): string {
  return process.env.RATE_LIMIT_SALT?.trim() || process.env.CRON_SECRET?.trim() || "ssa-scheduling";
}

/** El hash de una IP. Nunca se devuelve la IP. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${salt()}:${ip}`).digest("hex").slice(0, 32);
}

/** La clave del tope: prefijo del modulo, accion y hash. */
export function rateLimitKey(action: RateLimitAction, ip: string): string {
  return `scheduling:${action}:${hashIp(ip)}`;
}

/** El comienzo de la ventana en la que cae `now`. */
export function windowStart(action: RateLimitAction, now: Date = new Date()): string {
  const size = LIMITS[action].windowMs;
  return new Date(Math.floor(now.getTime() / size) * size).toISOString();
}

/** La IP del pedido, de los encabezados del proxy. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "0.0.0.0";
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  max: number;
}

/** Suma uno y dice si se paso. Un error de base no bloquea (se permite). */
export async function checkRateLimit(
  service: SupabaseClient<Database>,
  action: RateLimitAction,
  ip: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const { data, error } = await service.rpc("bump_rate_limit", {
    p_key: rateLimitKey(action, ip),
    p_window_start: windowStart(action, now),
  });
  if (error) {
    console.error("[agenda] no pude contar el tope por IP:", error.message);
    return { allowed: true, count: 0, max: LIMITS[action].max };
  }
  const count = (data as number) ?? 0;
  return { allowed: count <= LIMITS[action].max, count, max: LIMITS[action].max };
}

/** Los UTM y los click ids que se guardan en la agenda y en el contacto. */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"] as const;

export function pickUtm(params: Record<string, string | undefined> | URLSearchParams): Record<string, string> {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : params[k]);
  const out: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = get(key);
    if (value) out[key] = String(value).slice(0, 200);
  }
  return out;
}

/** El origen de la agenda: `embed` si vino del iframe, si no la pagina publica. */
export function originFrom(params: { embed?: string | null } | URLSearchParams): "embed" | "public_page" {
  const embed = params instanceof URLSearchParams ? params.get("embed") : params.embed;
  return embed === "1" || embed === "true" ? "embed" : "public_page";
}

/** La pagina desde la que se llego, validada. */
export function safeReferrer(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

/** El uid publico de una agenda: 22 caracteres URL-safe (unos 131 bits). */
export function newBookingUid(random: () => string = () => createHash("sha256").update(crypto.randomUUID() + Math.random()).digest("base64url")): string {
  return random().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 22);
}
