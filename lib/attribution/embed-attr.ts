/**
 * El parámetro `attr` del embed (F10): la atribución y las cookies de la web
 * que embebe el formulario, en un solo parámetro (JSON en base64url, hasta
 * 4 KB: 2 KB hasta el plano formularios-ui; la URL de entrada completa, que puede
 * pesar 2000 caracteres, tiene que entrar entera). El iframe no ve las cookies de la web que lo contiene, así que el
 * script del embed las lee allá y se las pasa por acá.
 *
 * El servidor NO confía en lo que trae: lo vuelve a sanear con
 * `sanitizeAttribution`. PURO y sin dependencias de Node (`btoa`/`atob` existen
 * en el navegador y en Node 16+), porque también lo importa el embed.
 */

export const ATTR_MAX_BYTES = 4096;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** JSON → base64url. Devuelve null si no entra en el tope. */
export function encodeAttr(value: Record<string, unknown>): string | null {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength > ATTR_MAX_BYTES) return null;
  return toBase64Url(bytes);
}

/** base64url → objeto plano, o null si está roto, no es un objeto o pesa de más. */
export function decodeAttr(text: string | null | undefined): Record<string, unknown> | null {
  if (!text || text.length > Math.ceil((ATTR_MAX_BYTES * 4) / 3) + 4) return null;
  try {
    const json = new TextDecoder().decode(fromBase64Url(text));
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
