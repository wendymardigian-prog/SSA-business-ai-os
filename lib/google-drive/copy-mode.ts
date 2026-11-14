/**
 * Como se copia un archivo de Drive segun su tipo (00374). Puro: lo usan la
 * pantalla y el servidor.
 *
 * Docs, Sheets, Slides y Drawings no son archivos: no tienen bytes propios y se
 * exportan a PDF (lo que mejor viaja por WhatsApp o email). Una carpeta, un
 * Form o un sitio no se pueden copiar: solo guardar como enlace.
 */

export const GOOGLE_APPS_PREFIX = "application/vnd.google-apps.";

/** Los tipos de Google que se pueden exportar a PDF. */
const EXPORTABLE_TO_PDF = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.drawing",
]);

export type DriveCopyMode =
  /** Un archivo de verdad: se descarga tal cual. */
  | { kind: "download" }
  /** Un archivo de Google: se exporta a PDF. */
  | { kind: "export"; mimeType: "application/pdf" }
  /** No se puede copiar (carpeta, Form, sitio, acceso directo). */
  | { kind: "link_only"; reason: string };

/** Como se copia un archivo de Drive, segun su tipo. Pura. */
export function driveCopyMode(mimeType: string): DriveCopyMode {
  if (!mimeType.startsWith(GOOGLE_APPS_PREFIX)) return { kind: "download" };
  if (EXPORTABLE_TO_PDF.has(mimeType)) return { kind: "export", mimeType: "application/pdf" };
  if (mimeType === `${GOOGLE_APPS_PREFIX}folder`) {
    return { kind: "link_only", reason: "Una carpeta no se puede copiar: se guarda como enlace." };
  }
  return { kind: "link_only", reason: "Este tipo de archivo de Google no se puede copiar: se guarda como enlace." };
}
