/**
 * Lee el cuerpo de un pedido con un tope de bytes, sin cargarlo entero si se pasa.
 *
 * Un endpoint publico no puede confiar en `Content-Length` (se puede mentir u
 * omitir): se lee por partes y se corta apenas pasa el maximo. Los formularios
 * `multipart/form-data` se aplanan a texto (se ignoran los archivos): para un
 * webhook, lo que importa son los campos.
 */
import { MAX_BODY_BYTES } from "./receive";

export type BodyRead = { text: string; bytes: number; asContentType?: string } | { tooLarge: true };

export async function readBodyCapped(request: Request, maxBytes: number = MAX_BODY_BYTES): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const text = await multipartToUrlencoded(bytes, contentType);
    return { text, bytes: total, asContentType: "application/x-www-form-urlencoded" };
  }
  return { text: new TextDecoder().decode(bytes), bytes: total };
}

/** Los campos de texto de un multipart como `a=1&b=2`; los archivos se descartan. */
export async function multipartToUrlencoded(bytes: Uint8Array, contentType: string): Promise<string> {
  try {
    const form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
    const params = new URLSearchParams();
    form.forEach((value, key) => {
      if (typeof value === "string") params.append(key, value);
    });
    return params.toString();
  } catch {
    return "";
  }
}
