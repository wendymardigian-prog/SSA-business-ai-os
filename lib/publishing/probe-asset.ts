/**
 * El video de un segundo que usa la prueba de YouTube (F38).
 *
 * Vive en el repo (`assets/youtube-probe.mp4`, 2 KB, generado con ffmpeg:
 * un cuadro negro de 256x144 durante un segundo) y no se descarga de
 * ningun lado: una prueba que depende de bajar algo de internet falla por
 * el motivo equivocado.
 *
 * Se lee del disco una sola vez y queda en memoria: son dos kilobytes.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChunkReader } from "./youtube";

export const PROBE_ASSET_PATH = join(process.cwd(), "lib/publishing/assets/youtube-probe.mp4");

let cached: Buffer | null = null;

export async function probeVideo(path = PROBE_ASSET_PATH): Promise<{
  sizeBytes: number;
  contentType: string;
  read: ChunkReader;
}> {
  cached ??= await readFile(path);
  const bytes = cached;

  return {
    sizeBytes: bytes.byteLength,
    contentType: "video/mp4",
    read: async (start: number, end: number) => {
      const slice = bytes.subarray(start, end + 1);
      // Copia: el buffer cacheado se reusa entre pruebas y no se puede
      // entregar una vista que despues alguien modifique.
      return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer;
    },
  };
}

/** Para los tests. */
export function resetProbeAsset(): void {
  cached = null;
}
