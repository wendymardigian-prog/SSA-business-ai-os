/**
 * La firma del negocio ("Firma de ambas partes"): la imagen que se dibuja o se sube una vez en el editor y se estampa
 * en cada contrato. PURO.
 *
 * Se acepta un PNG (lo que da el lienzo de firma) o un JPG (una foto o un escaneo de la firma), comprobado por sus
 * BYTES, no por lo que dice el navegador, y de hasta 500 KB. El PDF puede incrustar los dos formatos.
 */
import { isPng } from "./signature";

export const MAX_BUSINESS_SIGNATURE_BYTES = 500 * 1024;
const DATA_URL = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/;

export type BusinessSignatureUpload = { ok: true; bytes: Uint8Array; ext: "png" | "jpg"; mime: "image/png" | "image/jpeg" } | { ok: false; error: string };

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function parseBusinessSignature(dataUrl: unknown): BusinessSignatureUpload {
  if (typeof dataUrl !== "string") return { ok: false, error: "No llegó ninguna imagen" };
  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) return { ok: false, error: "La firma tiene que ser una imagen PNG o JPG" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(match[2], "base64"));
  } catch {
    return { ok: false, error: "La imagen no se pudo leer" };
  }
  if (bytes.byteLength === 0) return { ok: false, error: "La imagen está vacía" };
  if (bytes.byteLength > MAX_BUSINESS_SIGNATURE_BYTES) return { ok: false, error: "La imagen pesa más de 500 KB: probá con una más chica" };
  if (isPng(bytes)) return { ok: true, bytes, ext: "png", mime: "image/png" };
  if (isJpeg(bytes)) return { ok: true, bytes, ext: "jpg", mime: "image/jpeg" };
  return { ok: false, error: "La firma tiene que ser una imagen PNG o JPG" };
}

/** Dónde se guarda: una ruta NUEVA por cada imagen (nunca se pisa), así una firma vieja sigue apuntando a la suya. */
export function businessSignaturePath(workspaceId: string, formId: string, id: string, ext: "png" | "jpg"): string {
  return `${workspaceId}/${formId}/business-signer/${id}.${ext}`;
}
