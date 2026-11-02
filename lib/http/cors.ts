/**
 * CORS de las rutas públicas que llama la web de un cliente desde otro dominio.
 *
 * PURO (sin base): las rutas leen los orígenes permitidos del workspace del recurso
 * (`lib/http/workspace-origins.ts`) y le preguntan acá qué hacer.
 *
 * Tres reglas:
 *   - Nunca `*`: el header lleva el origen EXACTO que está en la lista del workspace.
 *   - Sin credenciales: ni cookies ni `Access-Control-Allow-Credentials`.
 *   - El servidor también rechaza: un `fetch` con FormData o un `<form>` HTML es un pedido
 *     "simple" que el navegador manda SIN preguntar antes (no hay preflight). CORS solo le
 *     esconde la respuesta, así que sin este rechazo otro sitio podría igual guardar
 *     respuestas en un formulario ajeno. Un pedido sin `Origin` (curl, de servidor a
 *     servidor) y uno de la propia app (`/f/<slug>`, el embed, el sitio propio) pasan.
 */
import { isOriginAllowed, type WebsiteSettings } from "@/lib/settings/website";

export const CORS_MAX_AGE_SECONDS = 600;

/**
 * - `none`: sin header `Origin` (curl, servidor a servidor). Pasa, sin headers de CORS.
 * - `same`: la propia app. Pasa, sin headers de CORS (no hacen falta).
 * - `allowed`: un origen de la lista del workspace. Pasa, con headers de CORS.
 * - `denied`: cualquier otro (incluido `Origin: null`). No pasa y no lleva headers.
 */
export type OriginDecision = "none" | "same" | "allowed" | "denied";

/** El origen (`https://host[:puerto]`) de una URL, o null si no es una URL http(s). */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Los orígenes de la propia app: el de `NEXT_PUBLIC_APP_URL` y el del pedido tal como
 * llegó (detrás del proxy de Railway, `x-forwarded-host` / `host`). El segundo cubre un
 * dominio propio apuntado a la app: la página `/f/<slug>` servida ahí manda al mismo host.
 */
export function selfOrigins(appUrl: string, headers: Headers): string[] {
  const out = new Set<string>();
  const fromApp = originOf(appUrl);
  if (fromApp) out.add(fromApp);
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
  if (host) {
    const proto = (headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() || (fromApp?.startsWith("http://") ? "http" : "https");
    const self = originOf(`${proto}://${host}`);
    if (self) out.add(self);
  }
  return [...out];
}

export function decideOrigin(origin: string | null, self: string[], settings: WebsiteSettings): OriginDecision {
  if (origin === null || origin === undefined || origin.trim() === "") return "none";
  const wanted = origin.trim().toLowerCase();
  if (self.includes(wanted)) return "same";
  return isOriginAllowed(wanted, settings) ? "allowed" : "denied";
}

/** Los headers de CORS para un origen PERMITIDO (para `same`/`none`/`denied`, ninguno). */
export function corsHeaders(decision: OriginDecision, origin: string | null, methods: string[]): Record<string, string> {
  if (decision !== "allowed" || !origin) return {};
  return {
    "Access-Control-Allow-Origin": origin.trim().toLowerCase(),
    "Access-Control-Allow-Methods": [...methods, "OPTIONS"].join(", "),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
    Vary: "Origin",
  };
}

/**
 * `Vary: Origin` en TODA respuesta de una ruta con CORS, también sin headers de CORS: así
 * un cache intermedio no le sirve a un origen la respuesta que armó para otro.
 */
export function withCors(headers: Record<string, string>): Record<string, string> {
  return headers.Vary ? headers : { ...headers, Vary: "Origin" };
}
