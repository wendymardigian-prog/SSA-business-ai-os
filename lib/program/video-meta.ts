// @plantilla-quitar(servicios)
/**
 * Lo que un link de video no dice solo (solo servidor): hoy, la miniatura y la duración de un Loom, por su oEmbed.
 * Si Loom no contesta en 5 segundos o contesta mal, devuelve null y la clase se guarda igual (sin miniatura propia
 * se ve el ícono del tipo). Solo pide a loom.com con un id ya validado: no hay dirección que escriba una persona.
 */
import { loomIdFromEmbed, loomOembedUrl, parseLoomOembed } from "@/lib/program/video-url";

export async function videoMeta(embedUrl: string | null): Promise<{ thumbnailUrl: string | null; durationSeconds: number | null } | null> {
  const id = loomIdFromEmbed(embedUrl);
  if (!id) return null;
  try {
    const res = await fetch(loomOembedUrl(id), { signal: AbortSignal.timeout(5_000), headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    return parseLoomOembed(await res.json());
  } catch {
    return null;
  }
}
