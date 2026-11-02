/**
 * La web del negocio (`workspaces.website_settings`, 00277): los orígenes desde los que
 * un navegador puede mandar formularios y pedir un link de baja.
 *
 * PURO: lo usan la pantalla (Ajustes → Integraciones → Tu sitio web), la acción que
 * guarda y las rutas públicas (`lib/http/cors.ts`).
 *
 * Un origen es exacto: esquema + dominio + puerto, sin ruta, query ni `#`. Solo `https`,
 * salvo `http://localhost` y `http://127.0.0.1`, que se aceptan únicamente marcados como
 * "de desarrollo" (para probar la web en la compu antes de publicarla).
 */

export interface AllowedOrigin {
  /** `https://tusitio.com`, en minúsculas y sin barra final. */
  origin: string;
  /** De desarrollo: lo único que admite `http://localhost:<puerto>`. */
  dev: boolean;
}

export interface WebsiteSettings {
  allowedOrigins: AllowedOrigin[];
}

export const MAX_ALLOWED_ORIGINS = 20;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export type OriginCheck =
  | { ok: true; origin: string }
  | { ok: false; error: string };

/**
 * Valida y normaliza un origen escrito por una persona. `dev` dice si se lo marcó como de
 * desarrollo: sin la marca, `http://localhost` se rechaza (y con la marca, solo localhost).
 */
export function validateOrigin(raw: string, dev: boolean): OriginCheck {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, error: "Escribí la dirección del sitio" };
  if (/\s/.test(text)) return { ok: false, error: "La dirección no puede tener espacios" };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "No es una dirección válida. Ejemplo: https://tusitio.com" };
  }
  if (url.username || url.password) return { ok: false, error: "La dirección no puede llevar usuario ni contraseña" };
  // Solo el origen: "https://tusitio.com/" se acepta (la barra sola), una ruta no.
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash || /[?#]/.test(text)) {
    return { ok: false, error: "Solo el dominio, sin ruta: https://tusitio.com (no https://tusitio.com/pagina)" };
  }

  const host = url.hostname.toLowerCase();
  const isLocal = LOCAL_HOSTS.has(host);
  if (url.protocol === "https:") {
    if (isLocal && !dev) return { ok: false, error: "Una dirección local se carga como de desarrollo" };
  } else if (url.protocol === "http:") {
    if (!isLocal) return { ok: false, error: "Tiene que empezar con https://" };
    if (!dev) return { ok: false, error: "http:// solo se acepta para localhost, marcado como de desarrollo" };
  } else {
    return { ok: false, error: "Tiene que empezar con https://" };
  }
  if (dev && !isLocal) return { ok: false, error: "Solo localhost o 127.0.0.1 se marcan como de desarrollo" };
  if (!host.includes(".") && !isLocal) return { ok: false, error: "Falta el dominio completo. Ejemplo: https://tusitio.com" };

  // `URL.origin` ya saca el puerto por defecto (443 en https) y pasa el dominio a minúsculas.
  return { ok: true, origin: url.origin.toLowerCase() };
}

/** Lo guardado (jsonb) como `WebsiteSettings`. Lo que no tiene forma de origen válido se descarta. */
export function parseWebsiteSettings(raw: unknown): WebsiteSettings {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.allowed_origins) ? obj.allowed_origins : [];
  const seen = new Set<string>();
  const allowedOrigins: AllowedOrigin[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.origin !== "string") continue;
    const dev = entry.dev === true;
    const checked = validateOrigin(entry.origin, dev);
    if (!checked.ok || seen.has(checked.origin)) continue;
    seen.add(checked.origin);
    allowedOrigins.push({ origin: checked.origin, dev });
    if (allowedOrigins.length >= MAX_ALLOWED_ORIGINS) break;
  }
  return { allowedOrigins };
}

export function serializeWebsiteSettings(settings: WebsiteSettings): { allowed_origins: Array<{ origin: string; dev: boolean }> } {
  return { allowed_origins: settings.allowedOrigins.map((o) => ({ origin: o.origin, dev: o.dev })) };
}

export type OriginsInput = Array<{ origin: string; dev?: boolean }>;

export type ValidatedOrigins =
  | { ok: true; settings: WebsiteSettings }
  | { ok: false; errors: Record<number, string>; message: string };

/**
 * La lista que manda la pantalla, validada entera (la acción la vuelve a validar en el servidor).
 * Un error por fila, con su posición; los repetidos son un error, no se descartan en silencio.
 */
export function validateOriginsInput(input: OriginsInput): ValidatedOrigins {
  if (!Array.isArray(input)) return { ok: false, errors: {}, message: "La lista no es válida" };
  if (input.length > MAX_ALLOWED_ORIGINS) {
    return { ok: false, errors: {}, message: `Podés cargar hasta ${MAX_ALLOWED_ORIGINS} direcciones` };
  }
  const errors: Record<number, string> = {};
  const seen = new Set<string>();
  const allowedOrigins: AllowedOrigin[] = [];
  input.forEach((item, index) => {
    const dev = item?.dev === true;
    const checked = validateOrigin(typeof item?.origin === "string" ? item.origin : "", dev);
    if (!checked.ok) {
      errors[index] = checked.error;
      return;
    }
    if (seen.has(checked.origin)) {
      errors[index] = "Esta dirección ya está en la lista";
      return;
    }
    seen.add(checked.origin);
    allowedOrigins.push({ origin: checked.origin, dev });
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors, message: "Revisá las direcciones marcadas" };
  return { ok: true, settings: { allowedOrigins } };
}

/** ¿Este origen (el header `Origin` del pedido, tal cual) está en la lista? Comparación exacta. */
export function isOriginAllowed(origin: string | null | undefined, settings: WebsiteSettings): boolean {
  if (!origin) return false;
  const wanted = origin.trim().toLowerCase();
  return settings.allowedOrigins.some((o) => o.origin === wanted);
}
