import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Los primeros bytes de un archivo YA SUBIDO a un bucket privado, sin bajarlo entero (un video puede pesar 1 GB).
 *
 * La subida de Contenido va directo del navegador al bucket: el servidor solo vio la cabecera que mandó el navegador
 * al pedir el permiso. Antes de anotar el archivo en la pieza se vuelve a mirar lo que de verdad quedó guardado.
 * El pedido va a la URL firmada de nuestro propio Supabase (el host sale de la configuración, no del navegador).
 * `null` = no se pudo leer.
 */
export async function readStoredHead(service: SupabaseClient, bucket: string, path: string, bytes = 64): Promise<Uint8Array | null> {
  try {
    const { data, error } = await service.storage.from(bucket).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return null;
    const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${bytes - 1}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !res.body) return null;
    // Se lee por partes y se corta apenas alcanza: si el servidor ignorara el Range, igual no se baja el archivo entero.
    const reader = res.body.getReader();
    const out = new Uint8Array(bytes);
    let filled = 0;
    while (filled < bytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, bytes - filled);
      out.set(value.subarray(0, take), filled);
      filled += take;
    }
    await reader.cancel().catch(() => {});
    return out.slice(0, filled);
  } catch {
    return null;
  }
}
