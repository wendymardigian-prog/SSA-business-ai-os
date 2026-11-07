/**
 * Un `fetch` hacia una direccion que escribio una persona (la "Llamada HTTP" de las automatizaciones).
 *
 * Tres cosas que un fetch suelto no hace:
 *  - **No deja pedir direcciones internas** (SSRF): localhost, la red privada, la metadata del proveedor de nube
 *    (169.254.169.254). Se resuelve el nombre y se mira CADA direccion, tambien en cada redireccion.
 *  - **Corta por tiempo** (10 s por defecto): un servidor colgado bloqueaba la corrida entera del cron.
 *  - **Corta por tamaño** (256 KB por defecto): la respuesta se guarda en las variables de la sesion (jsonb).
 *
 * Solo servidor.
 */

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export const SAFE_FETCH_TIMEOUT_MS = 10_000;
export const SAFE_FETCH_MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

export class BlockedUrlError extends Error {}

/**
 * Las direcciones que no se pueden pedir. `BlockList` compara por el valor de la IP y no por como esta escrita: un
 * IPv4 mapeado llega como `::ffff:7f00:1` (asi lo normaliza `new URL`) y una expresion regular sobre el texto lo dejaba pasar.
 */
const BLOCKED_ADDRESSES = new BlockList();
for (const [base, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(base, bits, "ipv4");
}
for (const [base, bits] of [
  ["::", 96], // sin especificar, loopback y el IPv4 "compatible" (::7f00:1)
  ["64:ff9b::", 96], // NAT64: lleva un IPv4 adentro
  ["2001::", 32], // Teredo: idem
  ["2002::", 16], // 6to4: idem
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(base, bits, "ipv6");
}

/** Si una IP es de las que no se pueden pedir desde el servidor (internas, de la nube, reservadas). */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(ip);
  if (version === 4) return BLOCKED_ADDRESSES.check(ip, "ipv4");
  if (version === 6) return BLOCKED_ADDRESSES.check(ip, "ipv6");
  return true;
}

/** Valida la direccion: http(s), sin usuario ni clave, y que todas sus IPs sean publicas. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("La dirección no es válida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError("Solo se pueden llamar direcciones http o https.");
  if (url.username || url.password) throw new BlockedUrlError("La dirección no puede llevar usuario y clave.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new BlockedUrlError("No se pueden llamar direcciones internas.");
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) throw new BlockedUrlError("No se pueden llamar direcciones internas.");
  return url;
}

export interface SafeFetchResult {
  status: number;
  ok: boolean;
  text: string;
  truncated: boolean;
  /** El `content-type` de la respuesta, en minusculas y sin parametros. Vacio si no vino. */
  contentType: string;
  /** La direccion que respondio, despues de las redirecciones. */
  finalUrl: string;
}

/** El juego de caracteres de la respuesta: el del encabezado o, en un HTML que no lo dice, el del `<meta>`. Si no, UTF-8. */
function decoderFor(contentType: string, head: Uint8Array): TextDecoder {
  let label = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!label && /html/i.test(contentType)) {
    const start = new TextDecoder("latin1").decode(head.subarray(0, 1024));
    label = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(start)?.[1];
  }
  try {
    return new TextDecoder(label ?? "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

/** Lee el cuerpo hasta `maxBytes`; si se pasa, corta y lo marca. */
async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = Buffer.concat(chunks);
  return { text: decoderFor(response.headers.get("content-type") ?? "", bytes).decode(bytes), truncated };
}

/**
 * Lo mismo que `safeFetch` (IPs publicas en cada salto, redirecciones a mano, corte por tiempo) pero devuelve la
 * respuesta final SIN leer el cuerpo: para bajar un archivo binario (la media de un mensaje), que no es texto y
 * tiene su propio tope de tamaño. Quien llama lee el cuerpo antes de que venza `timeoutMs`.
 */
export async function safeFetchResponse(
  rawUrl: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch; checkUrl?: (url: string) => Promise<URL> } = {},
): Promise<{ response: Response; finalUrl: string }> {
  const check = options.checkUrl ?? assertPublicUrl;
  const doFetch = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS);
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await check(current);
    const response = await doFetch(url, { method: "GET", redirect: "manual", signal, cache: "no-store" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      current = new URL(location, url).toString();
      continue;
    }
    return { response, finalUrl: url.toString() };
  }
  throw new BlockedUrlError("Demasiadas redirecciones.");
}

export async function safeFetch(
  rawUrl: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  options: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch; checkUrl?: (url: string) => Promise<URL> } = {},
): Promise<SafeFetchResult> {
  const check = options.checkUrl ?? assertPublicUrl;
  const doFetch = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS);
  let current = rawUrl;
  let method = init.method;
  let body = init.body;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await check(current);
    const response = await doFetch(url, { method, headers: init.headers, body, redirect: "manual", signal, cache: "no-store" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, url).toString();
      // Como los navegadores: un 303 (o un 301/302 despues de un POST) sigue con GET y sin cuerpo.
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    const { text, truncated } = await readCapped(response, options.maxBytes ?? SAFE_FETCH_MAX_BYTES);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    return { status: response.status, ok: response.ok, text, truncated, contentType, finalUrl: url.toString() };
  }
  throw new BlockedUrlError("Demasiadas redirecciones.");
}
