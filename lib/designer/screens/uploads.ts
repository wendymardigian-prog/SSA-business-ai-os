/**
 * La revisión rápida de un archivo ANTES de subirlo (F22): evita el viaje al servidor cuando ya se sabe que no sirve.
 *
 * Es solo comodidad: la validación de verdad es la del servidor, por los BYTES (`checkImageUpload`), porque el nombre
 * y el tipo que declara el navegador los puede escribir cualquiera.
 *
 * Módulo puro.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const SVG_NOT_ALLOWED = "Usá PNG o JPG (también WebP): un SVG no se puede usar.";

export interface PickedFile {
  name: string;
  size: number;
  type: string;
}

/** `null` = puede ir al servidor; si no, el motivo en español. */
export function precheckImage(file: PickedFile): string | null {
  const name = file.name.toLowerCase();
  if (file.type === "image/svg+xml" || name.endsWith(".svg") || name.endsWith(".svgz")) return SVG_NOT_ALLOWED;
  if (file.size === 0) return "El archivo está vacío.";
  if (file.size > MAX_UPLOAD_BYTES) return "La imagen pesa más de 20 MB.";
  if (file.type && !/^image\/(png|jpe?g|webp)$/.test(file.type)) return "Usá PNG o JPG (también WebP).";
  return null;
}

/** El valor de `accept` del selector de archivos. */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
