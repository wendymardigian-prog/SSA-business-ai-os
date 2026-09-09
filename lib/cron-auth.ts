import { NextResponse, type NextRequest } from "next/server";
import { constantTimeEquals } from "./crypto";

/**
 * Autorizacion de las rutas de cron.
 *
 * Este bloque estaba copiado identico en las seis rutas de app/api/cron/**, con
 * tres problemas:
 *
 * 1. Aceptaba el secreto por query string (`?key=`) y ademas con precedencia
 *    sobre el header. Un secreto en la URL queda escrito en los logs de acceso
 *    del proxy y en la tabla de respuestas de pg_net. El cron real nunca lo
 *    mando asi: private.call_app_cron (migracion 00036) usa solo el header.
 * 2. Comparaba con `!==`, mientras el webhook de Evolution ya usaba comparacion
 *    en tiempo constante para lo mismo.
 * 3. Con CRON_SECRET sin configurar devolvia 401, que es mentira: dice "no
 *    autorizado" cuando el problema es que el servidor esta mal desplegado.
 *
 * Mismo patron que app/api/webhooks/evolution/route.ts, que es el que el repo
 * ya decidio que es el bueno.
 */

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string };

/**
 * Saca el token de un header Authorization.
 *
 * Devuelve null si falta o si no viene con el prefijo "Bearer ". Reemplaza a un
 * `.replace("Bearer ", "")` que no anclaba el prefijo: "Token Bearer abc"
 * pasaba como si fuera un Bearer valido.
 *
 * El scheme es case-insensitive por RFC 7235, asi que "bearer" tambien vale.
 */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * El chequeo en si. Pura, sin Next: es lo unico que hay que testear, y asi el
 * test corre sin fabricar un NextRequest.
 */
export function checkCronSecret(
  provided: string | null | undefined,
  expected: string | null | undefined
): CronAuthResult {
  const secret = expected?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 500,
      error: "El cron no esta configurado en este entorno",
    };
  }
  if (!provided || !constantTimeEquals(provided, secret)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

/**
 * Lo que llaman las rutas:
 *
 *   const denied = authorizeCronRequest(request);
 *   if (denied) return denied;
 *
 * Devuelve la respuesta con la que cortar, o null para seguir.
 */
export function authorizeCronRequest(request: NextRequest): NextResponse | null {
  const result = checkCronSecret(
    parseBearerToken(request.headers.get("authorization")),
    process.env.CRON_SECRET
  );

  if (result.ok) return null;

  if (result.status === 500) {
    console.error("[cron] falta CRON_SECRET en el entorno");
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
