/**
 * Tope por clave, genérico (H10). Usa la tabla `rate_limits` y la función
 * `bump_rate_limit` que ya existen: la clave la arma quien llama
 * (`forms:submit:<hash ip>`), así que el módulo de la Agenda no se toca.
 *
 * SOLO servidor: usa el cliente de servicio y el hash de IP con sal.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { hashIp } from "@/lib/scheduling/antispam";

export interface LimitSpec {
  key: string;
  max: number;
  windowMs: number;
}

export interface LimitResult {
  allowed: boolean;
  count: number;
  max: number;
}

/** El comienzo de la ventana en la que cae `now`. */
export function windowStartFor(windowMs: number, now: Date = new Date()): string {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs).toISOString();
}

/**
 * Suma uno a la clave y dice si se pasó. Un error de base NO bloquea: un
 * formulario que deja de andar porque la tabla de topes falló es peor que un
 * tope flojo por un rato.
 */
export async function checkLimit(
  service: SupabaseClient<Database>,
  spec: LimitSpec,
  now: Date = new Date(),
): Promise<LimitResult> {
  try {
    const { data, error } = await service.rpc("bump_rate_limit", {
      p_key: spec.key,
      p_window_start: windowStartFor(spec.windowMs, now),
    });
    if (error) {
      console.error("[antispam] no pude contar el tope:", error.message);
      return { allowed: true, count: 0, max: spec.max };
    }
    const count = (data as number) ?? 0;
    return { allowed: count <= spec.max, count, max: spec.max };
  } catch (err) {
    console.error("[antispam] fallo contando el tope:", err instanceof Error ? err.message : String(err));
    return { allowed: true, count: 0, max: spec.max };
  }
}

/** `forms:submit:<hash ip>`, `forms:submit:<form>:<hash ip>`, `forms:beacon:<hash ip>`. */
export const formsKeys = {
  submit: (ip: string) => `forms:submit:${hashIp(ip)}`,
  submitForm: (formId: string, ip: string) => `forms:submit:${formId}:${hashIp(ip)}`,
  beacon: (ip: string) => `forms:beacon:${hashIp(ip)}`,
  /** Una vista o un inicio por sesión del navegador: el `sid` solo viaja hasheado. */
  session: (kind: "view" | "start", formId: string, sid: string) =>
    `forms:${kind}:${formId}:${createHash("sha256").update(sid).digest("hex").slice(0, 32)}`,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(sid: unknown): sid is string {
  return typeof sid === "string" && UUID_RE.test(sid);
}
