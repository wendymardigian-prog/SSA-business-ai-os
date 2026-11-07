/**
 * Leer una pagina para armar la tarjeta de vista previa. SOLO servidor.
 *
 * El pedido lo dispara un link que puede haber mandado cualquier desconocido, asi que va por `safeFetch` (sin direcciones
 * internas, con tope de tiempo y tamaño) y ademas:
 *  - solo puertos 80 y 443, tambien en cada redireccion;
 *  - nunca rutas `/auth/` ni `/api/`: abrirlas puede gastar un link de un solo uso, en cualquier dominio;
 *  - se presenta con un nombre propio, que `isLinkPreviewBot` reconoce: abrir un link medido no cuenta como un clic.
 *
 * Nunca se loguea la URL (puede llevar un token) y nunca lanza: si algo falla, no hay tarjeta.
 *
 * La memoria dura hasta el proximo deploy, con el mismo criterio que `lib/meta/live.ts`: perderla solo cuesta volver a
 * leer una pagina. Guardar el fallo importa tanto como el acierto: un link roto no se vuelve a pedir cada vez que alguien
 * abre esa conversacion.
 */
import { assertPublicUrl, BlockedUrlError, safeFetch } from "@/lib/net/safe-fetch";
import { parseLinkPreview, type LinkPreview } from "./parse";

export const LINK_PREVIEW_USER_AGENT = "Mozilla/5.0 (compatible; LinkPreviewBot/1.0)";

export const LINK_PREVIEW_TIMEOUT_MS = 5_000;
export const MAX_LINK_PREVIEW_URL_LENGTH = 2000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TTL_OK = 24 * HOUR;
const TTL_FAILED = HOUR;
/** Un 429 o un 5xx hablan del momento, no del link. */
const TTL_TEMPORARY = 5 * MINUTE;
const MAX_ENTRIES = 500;

interface Entry {
  preview: LinkPreview | null;
  expires: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<LinkPreview | null>>();

/** Sin el `#`: la misma pagina con otro ancla es la misma tarjeta. */
function cacheKey(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}

function remember(key: string, preview: LinkPreview | null, ttl: number, now: number): void {
  cache.delete(key);
  cache.set(key, { preview, expires: now + ttl });
  // Un Map recorre en orden de insercion: la primera clave es la que hace mas tiempo que nadie usa.
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Lo que ya se sabe de este link: la tarjeta, `null` si no tiene, o `undefined` si nunca se pidio (o ya vencio). */
export function peekLinkPreview(url: string, now: number = Date.now()): LinkPreview | null | undefined {
  const key = cacheKey(url);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.preview;
}

/** Para los tests. */
export function clearLinkPreviewCache(): void {
  cache.clear();
  inFlight.clear();
}

/** La misma regla en la direccion pedida y en cada redireccion. */
async function checkPreviewUrl(raw: string): Promise<URL> {
  const url = await assertPublicUrl(raw);
  if (url.port !== "" && url.port !== "80" && url.port !== "443") throw new BlockedUrlError("Puerto no permitido.");
  if (/^\/(auth|api)(\/|$)/i.test(url.pathname)) throw new BlockedUrlError("Ruta no permitida.");
  return url;
}

/** Un link medido que termina en su propio dominio no llego a ningun destino: su token no sirve y cayo en la app. */
function fellBackToApp(requested: string, finalUrl: string): boolean {
  try {
    const from = new URL(requested);
    return /^\/l\//.test(from.pathname) && new URL(finalUrl).host === from.host;
  } catch {
    return false;
  }
}

async function load(url: string, fetchImpl: typeof fetch | undefined): Promise<{ preview: LinkPreview | null; ttl: number }> {
  try {
    const response = await safeFetch(
      url,
      { method: "GET", headers: { "user-agent": LINK_PREVIEW_USER_AGENT, accept: "text/html,application/xhtml+xml", "accept-language": "es,en;q=0.8" } },
      { timeoutMs: LINK_PREVIEW_TIMEOUT_MS, checkUrl: checkPreviewUrl, fetchImpl },
    );
    if (response.status === 429 || response.status >= 500) return { preview: null, ttl: TTL_TEMPORARY };
    if (!response.ok || !/^(text\/html|application\/xhtml\+xml)$/.test(response.contentType)) return { preview: null, ttl: TTL_FAILED };
    if (fellBackToApp(url, response.finalUrl)) return { preview: null, ttl: TTL_FAILED };
    const preview = parseLinkPreview(response.text, response.finalUrl);
    return { preview, ttl: preview ? TTL_OK : TTL_FAILED };
  } catch (error) {
    // Sin loguear: el mensaje del error puede traer la direccion. Un bloqueo no cambia; la red o un servidor lento, si.
    return { preview: null, ttl: error instanceof BlockedUrlError ? TTL_FAILED : TTL_TEMPORARY };
  }
}

/** La tarjeta de un link. Dos pedidos simultaneos del mismo link hacen una sola lectura. */
export async function getLinkPreview(url: string, options: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<LinkPreview | null> {
  const known = peekLinkPreview(url, options.now);
  if (known !== undefined) return known;

  const key = cacheKey(url);
  const running = inFlight.get(key);
  if (running) return running;

  const pending = load(url, options.fetchImpl)
    .then(({ preview, ttl }) => {
      remember(key, preview, ttl, options.now ?? Date.now());
      return preview;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}
