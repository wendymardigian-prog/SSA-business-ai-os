/**
 * Lee los bytes del cuerpo de un pedido con un tope, sin cargarlo entero si se pasa.
 *
 * Primero mira `Content-Length` (si el pedido declara más del tope, no se lee nada);
 * después lee por partes y corta apenas se pasa, porque el tamaño se puede omitir
 * (`Transfer-Encoding: chunked`) o mentir. Mismo criterio que `readBodyCapped` de los
 * webhooks, pero devuelve los bytes tal cual: un formulario necesita sus archivos.
 */

export type CappedBody = { ok: true; bytes: Uint8Array } | { ok: false; tooLarge: true };

/** ¿El pedido DECLARA más bytes que el tope? (sin leer nada). */
export function declaresMoreThan(headers: Headers, maxBytes: number): boolean {
  const declared = Number(headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}

export async function readBytesCapped(request: Request, maxBytes: number): Promise<CappedBody> {
  if (declaresMoreThan(request.headers, maxBytes)) return { ok: false, tooLarge: true };

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
        return { ok: false, tooLarge: true };
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
  return { ok: true, bytes };
}
