/**
 * Prepara el logo de un negocio para dibujarlo en la imagen de la tarjeta. Solo de servidor
 * (sharp es nativo). Se convierte siempre a PNG: el bucket admite webp y un logo de la
 * instalación puede ser cualquier cosa. Si algo falla devuelve null y la imagen usa la inicial:
 * la tarjeta nunca se cae por el logo.
 */
import sharp from "sharp";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 3000;
const MAX_WIDTH = 440;
const MAX_HEIGHT = 150;

export const PLATE_LIGHT = "#ffffff";
export const PLATE_DARK = "#111827";

export interface OgLogo {
  dataUrl: string;
  width: number;
  height: number;
  /** El fondo sobre el que se lee: un logo blanco con transparencia no se vería sobre blanco. */
  plate: string;
}

/**
 * El fondo del logo, mirando sus píxeles (RGBA). Solo un logo con transparencia y claro va
 * sobre oscuro: uno opaco trae su propio fondo y queda bien sobre blanco.
 */
export function logoPlate(rgba: Uint8Array): string {
  let visible = 0;
  let transparent = 0;
  let lightness = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) {
      transparent++;
      continue;
    }
    visible++;
    lightness += (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
  }
  if (visible === 0 || transparent === 0) return PLATE_LIGHT;
  return lightness / visible > 0.7 ? PLATE_DARK : PLATE_LIGHT;
}

export async function prepareLogo(input: Uint8Array): Promise<OgLogo> {
  const image = sharp(input, { failOn: "none" }).resize(MAX_WIDTH, MAX_HEIGHT, { fit: "inside" });
  const { data, info } = await image.clone().png().toBuffer({ resolveWithObject: true });
  const sample = await image.clone().resize(32, 32, { fit: "inside" }).ensureAlpha().raw().toBuffer();
  return {
    dataUrl: `data:image/png;base64,${data.toString("base64")}`,
    width: info.width,
    height: info.height,
    plate: logoPlate(sample),
  };
}

export async function loadLogo(url: string | null): Promise<OgLogo | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      console.error(`[vista previa] el logo respondió ${response.status}; uso la inicial`);
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INPUT_BYTES) {
      console.error("[vista previa] el logo está vacío o pesa demasiado; uso la inicial");
      return null;
    }
    return await prepareLogo(bytes);
  } catch (error) {
    console.error("[vista previa] no pude preparar el logo; uso la inicial:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
