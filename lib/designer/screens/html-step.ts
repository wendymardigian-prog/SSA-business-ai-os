/**
 * Las reglas del paso «Archivo» del modal Nuevo (F39–F41): qué se le pide a la persona, qué se le
 * muestra de lo detectado y qué se le avisa. El componente (`components/designer/import/html-step.tsx`)
 * solo las compone.
 *
 * Módulo puro (se puede importar desde el navegador).
 */

import type { DesignKind, HtmlImportKind, HtmlInspection } from "../contracts";
import { MAX_PAGES } from "../formats";

export const MAX_HTML_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ZIP_FILE_BYTES = 50 * 1024 * 1024;

export const DROP_TITLE = "Arrastrá tu archivo o elegilo";
export const DROP_HINT = ".html, o un .zip con el .html y sus imágenes y fuentes";

export const WEB_LABEL = "Página web";
export const SLIDES_LABEL = "Presentación (cada sección es una diapositiva)";

/** Lo que se pregunta antes de subir: la extensión y el tamaño (el servidor vuelve a mirar los bytes). */
export function checkPickedFile(file: { name: string; size: number }): { ok: true } | { ok: false; error: string } {
  const name = file.name.toLowerCase();
  const isZip = name.endsWith(".zip");
  const isHtml = name.endsWith(".html") || name.endsWith(".htm");
  if (!isZip && !isHtml) return { ok: false, error: "Subí un archivo .html o un .zip." };
  if (file.size === 0) return { ok: false, error: "El archivo está vacío." };
  if (isZip && file.size > MAX_ZIP_FILE_BYTES) return { ok: false, error: "El zip pesa más de 50 MB." };
  if (isHtml && file.size > MAX_HTML_FILE_BYTES) return { ok: false, error: "El .html pesa más de 5 MB. Si tiene imágenes, subilo en un .zip." };
  return { ok: true };
}

/** Las opciones de «¿Es correcto?»: una plantilla no puede ser una página web, así que ahí no se ofrece. */
export function formatOptions(kind: DesignKind): { key: HtmlImportKind; label: string }[] {
  const all: { key: HtmlImportKind; label: string }[] = [
    { key: "web", label: WEB_LABEL },
    { key: "slides", label: SLIDES_LABEL },
  ];
  return kind === "template" ? all.filter((o) => o.key === "slides") : all;
}

/** Con qué opción arranca: lo detectado, salvo una plantilla (que solo puede ser presentación). */
export function initialChoice(kind: DesignKind, inspection: Pick<HtmlInspection, "detected">): HtmlImportKind {
  if (kind === "template") return "slides";
  return inspection.detected.as;
}

/** Si la opción elegida no se puede cargar (más diapositivas que las que admite un diseño). */
export function choiceProblem(choice: HtmlImportKind, inspection: Pick<HtmlInspection, "detected">): string | null {
  if (choice === "slides" && inspection.detected.as === "slides" && inspection.detected.pages > MAX_PAGES) {
    return `El archivo tiene ${inspection.detected.pages} diapositivas y el máximo es ${MAX_PAGES}. Cargalo como página web o dividilo.`;
  }
  return null;
}

/** La línea «Se cargará como…» cuando la persona eligió algo distinto de lo detectado. */
export function loadAsText(choice: HtmlImportKind, inspection: Pick<HtmlInspection, "detected">): string | null {
  if (choice === inspection.detected.as) return null;
  return choice === "web" ? "Se va a cargar como página web: una sola página con scroll." : "Se va a cargar como presentación: cada sección será una diapositiva.";
}

/** «8 imágenes guardadas · 2 fuentes guardadas» (o que no hay). */
export function assetsText(assets: HtmlInspection["assets"]): string {
  const parts: string[] = [];
  if (assets.images > 0) parts.push(`${assets.images} ${assets.images === 1 ? "imagen guardada" : "imágenes guardadas"}`);
  if (assets.fonts > 0) parts.push(`${assets.fonts} ${assets.fonts === 1 ? "fuente guardada" : "fuentes guardadas"}`);
  return parts.length > 0 ? parts.join(" · ") : "El archivo no trae imágenes ni fuentes propias";
}

/** El texto de ayuda de abajo: lo de los scripts y qué se puede hacer después. */
export function helpText(kind: DesignKind): string {
  const variables = kind === "template" ? ", convertir partes en variables" : "";
  return `Los scripts del archivo se quitan por seguridad: se mantiene el diseño, no el código que se ejecuta. Después podés editar textos tocándolos${variables} o pedirle cambios a la IA.`;
}

/** Lo que se le avisa a quien carga (qué se quitó o no se pudo guardar), o `null` si no hubo nada. */
export function removedNotice(inspection: Pick<HtmlInspection, "removed">): string | null {
  return inspection.removed.summary;
}

/** Lo que recibe el modal: el archivo leído y la opción elegida, o `null` si todavía no se puede cargar. */
export function stepValue(inspection: HtmlInspection | null, choice: HtmlImportKind | null): { uploadId: string; as: HtmlImportKind } | null {
  if (!inspection || !choice) return null;
  if (choiceProblem(choice, inspection)) return null;
  return { uploadId: inspection.uploadId, as: choice };
}
