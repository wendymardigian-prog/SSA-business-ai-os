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
import { isIP } from "node:net";

export const SAFE_FETCH_TIMEOUT_MS = 10_000;
export const SAFE_FETCH_MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

export class BlockedUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inRange(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** Si una IP es de las que no se pueden pedir desde el servidor (internas, de la nube, reservadas). */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(ip);
  if (version === 4) {
    return [
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
    ].some(([base, bits]) => inRange(ip, base as string, bits as number));
  }
  if (version === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return /^(fc|fd)/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip);
  }
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
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
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
    return { status: response.status, ok: response.ok, text, truncated };
  }
  throw new BlockedUrlError("Demasiadas redirecciones.");
}
