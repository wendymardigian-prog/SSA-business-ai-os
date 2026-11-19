/**
 * El logo del negocio para el PDF de un contrato (18/11/2026). SOLO servidor (sharp es nativo).
 *
 * pdf-lib solo incrusta PNG y JPG, y el bucket de marca admite WebP: el logo se convierte SIEMPRE a PNG, achicado a
 * un tamaño que alcanza para imprimir nítido arriba de la hoja. Nunca lanza: un logo que no se puede bajar o leer
 * devuelve null y el PDF sale sin logo (un contrato nunca se frena por el logo). No se loguea la dirección.
 */
import sharp from "sharp";
import type { ContractPdfLogo } from "./pdf";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
/** Cuatro veces el tamaño máximo en la hoja (160 x 36 puntos): nítido al imprimir, liviano en el PDF. */
const MAX_WIDTH = 640;
const MAX_HEIGHT = 144;

/** Los bytes de una imagen → el PNG para el PDF, o null si no es una imagen que sharp pueda leer. */
export async function pdfLogoFromBytes(bytes: Uint8Array): Promise<ContractPdfLogo | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INPUT_BYTES) return null;
  try {
    const { data, info } = await sharp(bytes, { failOn: "none" })
      .resize(MAX_WIDTH, MAX_HEIGHT, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) return null;
    return { png: new Uint8Array(data), width: info.width, height: info.height };
  } catch (error) {
    console.error("[contrato] el logo no es una imagen legible; el PDF sale sin logo:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Baja el logo (la dirección pública del bucket de marca, o la de la instalación) y lo prepara para el PDF. */
export async function loadPdfLogo(url: string | null, fetchImpl: typeof fetch = fetch): Promise<ContractPdfLogo | null> {
  if (!url) return null;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      console.error(`[contrato] el logo respondió ${response.status}; el PDF sale sin logo`);
      return null;
    }
    return await pdfLogoFromBytes(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    console.error("[contrato] no pude bajar el logo; el PDF sale sin logo:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
