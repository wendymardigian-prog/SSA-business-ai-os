/**
 * Lee las dimensiones y la duracion de un archivo en el NAVEGADOR, antes de
 * subirlo (F92).
 *
 * Sirve para dos cosas que antes no se podian: mostrar la proporcion de cada
 * archivo en la biblioteca, y avisar que un Reel dura mas de lo que acepta
 * Instagram (la validacion de duracion no tenia de donde sacar el dato: nadie
 * lo guardaba). Es una pista y no un hecho: el servidor la recorta a valores
 * razonables y la red mira el archivo de verdad.
 *
 * Nunca lanza ni se cuelga: si no puede leerlo (formato raro, navegador sin la
 * API), devuelve todo en null y la subida sigue.
 */

export interface ProbedMedia {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

const NONE: ProbedMedia = { width: null, height: null, durationMs: null };
const TIMEOUT_MS = 8_000;

export async function probeMediaFile(file: Blob, mime: string): Promise<ProbedMedia> {
  if (typeof window === "undefined") return NONE;

  try {
    if (mime.startsWith("image/")) return await probeImage(file);
    if (mime.startsWith("video/")) return await probeVideo(file);
  } catch {
    // Una pista que no se pudo leer no frena la subida.
  }
  return NONE;
}

async function probeImage(file: Blob): Promise<ProbedMedia> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const out = { width: bitmap.width, height: bitmap.height, durationMs: null };
    bitmap.close?.();
    return out;
  }

  return await withObjectUrl(file, (url) =>
    new Promise<ProbedMedia>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, durationMs: null });
      img.onerror = () => resolve(NONE);
      img.src = url;
    }),
  );
}

async function probeVideo(file: Blob): Promise<ProbedMedia> {
  return await withObjectUrl(file, (url) =>
    new Promise<ProbedMedia>((resolve) => {
      const video = document.createElement("video");
      const done = (value: ProbedMedia) => {
        clearTimeout(timer);
        video.removeAttribute("src");
        video.load();
        resolve(value);
      };
      const timer = setTimeout(() => done(NONE), TIMEOUT_MS);

      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () =>
        done({
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null,
        });
      video.onerror = () => done(NONE);
      video.src = url;
    }),
  );
}

async function withObjectUrl<T>(file: Blob, use: (url: string) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file);
  try {
    return await use(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
