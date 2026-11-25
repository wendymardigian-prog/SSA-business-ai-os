/**
 * Las cabeceras de un envío que se guardan para auditar (`inbound_webhooks.headers`). PURO y NUNCA lanza.
 *
 * Nunca se guarda una credencial ni la IP completa: fuera `x-webhook-secret`, `authorization`, `cookie`, cualquier
 * nombre que parezca una clave (`isSensitiveParamName`, el mismo criterio de la atribución) y las cabeceras de IP
 * del proxy (la IP del envío ya se guarda truncada aparte). Topes: 50 cabeceras, 500 caracteres cada una y 8 KB.
 */
import { isSensitiveParamName } from "@/lib/attribution/sensitive-params";

export const HEADERS_MAX_COUNT = 50;
export const HEADER_VALUE_MAX = 500;
export const HEADERS_MAX_BYTES = 8 * 1024;

const ALWAYS_OUT = new Set([
  "x-webhook-secret",
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
  "x-envoy-external-address",
]);

const SECRET_LIKE = /(secret|token|signature|password|passwd|auth|session|api[-_]?key|credential)/i;

export function sanitizeHeaders(entries: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  let bytes = 2;
  let count = 0;
  try {
    for (const [rawName, rawValue] of entries) {
      const name = String(rawName).toLowerCase().trim();
      if (!name || ALWAYS_OUT.has(name) || SECRET_LIKE.test(name) || isSensitiveParamName(name)) continue;
      if (count >= HEADERS_MAX_COUNT) break;
      const value = String(rawValue ?? "").slice(0, HEADER_VALUE_MAX);
      const size = name.length + value.length + 6;
      if (bytes + size > HEADERS_MAX_BYTES) break;
      out[name] = value;
      bytes += size;
      count++;
    }
  } catch {
    // Lo que se alcanzó a leer.
  }
  return out;
}
