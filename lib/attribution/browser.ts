/**
 * El seguimiento de la atribución en el navegador (F29), sin tocar el DOM directo:
 * todo entra por un `TrackEnv` chico. Así se prueba entero con Vitest y lo comparten
 * las páginas del sitio (cookie `ssa_attr`) y el script de embed (`localStorage` de
 * la web que lo contiene).
 *
 * Regla de oro: NUNCA lanza. Si el navegador bloquea las cookies o el
 * `localStorage`, se sigue sin guardar nada y el formulario funciona igual, con la
 * atribución de la URL actual.
 *
 * No hace pedidos a la red ni carga scripts de terceros.
 */
import { attributionFromParams, parseCookieHeader } from "./collect";
import { effectiveAttribution, type EffectiveResult } from "./merge";
import { parseStored, recordVisit, serializeStored, MAX_AGE_DAYS, STORE_KEY } from "./store";
import type { Attribution, StoredAttribution, Visit } from "./types";

export interface TrackEnv {
  /** `location.href` de la página donde está el script. */
  href: string;
  /** `location.search`. */
  search: string;
  /** `location.hostname`, para decidir si el referrer es de otro sitio. */
  hostname: string;
  /** `document.referrer`. */
  referrer: string;
  /** `document.cookie`: de ahí salen `_fbp`, `_fbc` y `_ga`. */
  cookieHeader: string;
  /** Lee lo guardado (cookie `ssa_attr` o `localStorage`). Puede lanzar. */
  readStored(): string | null;
  /** Guarda el texto. Puede lanzar. */
  writeStored(text: string): void;
  /** Para tests. Por defecto, ahora. */
  now?: number;
}

/** El referrer solo cuenta si viene de OTRO sitio: navegar entre páginas propias no es de dónde vino la persona. */
export function referrerOfOtherSite(referrer: string | null | undefined, hostname: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.hostname.toLowerCase() === hostname.toLowerCase()) return null;
    return referrer;
  } catch {
    return null;
  }
}

/** La atribución de ESTA visita: URL, referrer de otro sitio, página y cookies de los anuncios. */
export function currentVisit(env: TrackEnv): Attribution {
  return attributionFromParams(new URLSearchParams(env.search), {
    referrer: referrerOfOtherSite(env.referrer, env.hostname),
    landing: env.href,
    pageUrl: env.href,
    cookies: parseCookieHeader(env.cookieHeader),
    now: env.now,
  });
}

function readSafe(env: TrackEnv): StoredAttribution {
  try {
    return parseStored(env.readStored(), env.now);
  } catch {
    return { v: 1 };
  }
}

/**
 * Registra la visita actual: si trae UTM, id de clic o de anuncio es un toque
 * nuevo y se guarda; si no, no cambia nada. Devuelve lo que quedó guardado.
 */
export function trackVisit(env: TrackEnv): StoredAttribution {
  const stored = readSafe(env);
  try {
    const next = recordVisit(stored, currentVisit(env), env.now);
    if (next !== stored) env.writeStored(serializeStored(next));
    return next;
  } catch {
    return stored;
  }
}

/** La atribución efectiva de la página: la URL actual si trae un toque nuevo; si no, el último guardado. */
export function pageAttribution(env: TrackEnv): EffectiveResult {
  try {
    return effectiveAttribution(currentVisit(env), readSafe(env));
  } catch {
    return {};
  }
}

// ── La cookie del sitio ──────────────────────────────────────────────────────

/** El tope de la cookie: el navegador admite ~4 KB por cookie y el valor va en base64 (+33 %). */
const COOKIE_JSON_BYTES = 2600;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** El valor de la cookie `ssa_attr`: el JSON guardado en base64url (sin comillas ni llaves que el navegador escaparía). */
export function encodeCookieValue(stored: StoredAttribution): string {
  return toBase64Url(serializeStored(stored, COOKIE_JSON_BYTES));
}

export function decodeCookieValue(value: string | null | undefined, now?: number): StoredAttribution {
  if (!value) return { v: 1 };
  try {
    return parseStored(fromBase64Url(value), now);
  } catch {
    return { v: 1 };
  }
}

/** El texto para `document.cookie = ...`: `SameSite=Lax`, `Path=/`, 90 días y `Secure` solo en https. */
export function buildCookie(value: string, options: { secure: boolean }): string {
  const parts = [`${STORE_KEY}=${value}`, `Max-Age=${MAX_AGE_DAYS * 86_400}`, "Path=/", "SameSite=Lax"];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** El `TrackEnv` de una página con cookies (el sitio y `/f/[slug]`). Recibe el `document` y el `location`. */
export function cookieEnv(doc: { cookie: string; referrer: string }, loc: { href: string; search: string; hostname: string; protocol: string }): TrackEnv {
  return {
    href: loc.href,
    search: loc.search,
    hostname: loc.hostname,
    referrer: doc.referrer,
    cookieHeader: doc.cookie,
    readStored: () => {
      try {
        const value = parseCookieHeader(doc.cookie)[STORE_KEY];
        return value ? fromBase64Url(value) : null;
      } catch {
        // Una cookie rota se trata como si no hubiera nada.
        return null;
      }
    },
    writeStored: (text) => {
      let stored: StoredAttribution;
      try {
        stored = parseStored(text);
      } catch {
        return;
      }
      doc.cookie = buildCookie(encodeCookieValue(stored), { secure: loc.protocol === "https:" });
    },
  };
}

/** La última visita guardada como un `StoredAttribution` armado desde una atribución plana ya efectiva (para el iframe de un embed). */
export function storedFromEffective(effective: Record<string, unknown> | null | undefined, now: number = Date.now()): StoredAttribution {
  if (!effective) return { v: 1 };
  const last: Visit = { ts: now };
  for (const [key, value] of Object.entries(effective)) {
    if (key === "first_visit") continue;
    if (typeof value === "string" && value !== "") last[key] = value;
  }
  const out: StoredAttribution = { v: 1, last };
  const first = effective.first_visit;
  if (first && typeof first === "object" && !Array.isArray(first) && typeof (first as Visit).ts === "number") out.first = first as Visit;
  return out;
}

export { STORE_KEY };
