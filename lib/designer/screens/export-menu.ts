/**
 * Lo que decide el menú Exportar / Exportar prueba de la barra del editor (F46), sin tocar la pantalla.
 *
 * - **Exportar**: PDF (todas las páginas) · Imágenes (ZIP, una por página) · Solo esta página (PNG). Con una sola
 *   página: PDF · Imagen PNG.
 * - **Exportar prueba** (plantillas): lo mismo con datos de ejemplo; no crea ninguna generación ni link.
 * - Una página web no se exporta: el botón está deshabilitado y dice por qué.
 * - Cuando el archivo tarda más de 3 s, aviso «Preparando tu archivo…»; se baja solo al terminar.
 *
 * Módulo puro.
 */

import { WEB_NOT_EXPORTABLE, type ExportKind } from "../export";
import { canExport, type FormatKey } from "../formats";

export interface ExportItem {
  /** Para la `key` y las pruebas. */
  id: string;
  kind: ExportKind;
  /** Solo `png` de «Solo esta página» (0 = la primera). */
  page?: number;
  label: string;
}

export interface ExportMenuView {
  /** Lo que dice el botón. */
  label: string;
  /** Si no se puede exportar, por qué (se muestra como ayuda del botón deshabilitado). */
  disabledReason: string | null;
  header: string;
  items: ExportItem[];
  note: string | null;
}

export function exportMenuView(input: { format: FormatKey; isTemplate: boolean; pageCount: number; currentPage: number }): ExportMenuView {
  const label = input.isTemplate ? "Exportar prueba" : "Exportar";
  const header = input.isTemplate ? "Exportar prueba (datos de ejemplo)" : "Exportar";
  if (!canExport(input.format)) return { label, disabledReason: WEB_NOT_EXPORTABLE, header, items: [], note: null };

  const multi = input.pageCount > 1;
  const page = Math.min(Math.max(0, Math.floor(input.currentPage) || 0), Math.max(0, input.pageCount - 1));
  const items: ExportItem[] = [{ id: "pdf", kind: "pdf", label: multi ? "PDF · todas las páginas" : "PDF" }];
  items.push(multi ? { id: "zip", kind: "zip", label: "Imágenes · una por página (ZIP)" } : { id: "png", kind: "png", label: "Imagen PNG" });
  if (multi) items.push({ id: `page-${page}`, kind: "png", page, label: `Solo la página ${page + 1} · PNG` });
  return { label, disabledReason: null, header, items, note: input.isTemplate ? "No genera ningún diseño ni link." : null };
}

/** Pasados estos milisegundos sin archivo, se avisa «Preparando tu archivo…». */
export const PREPARING_NOTICE_MS = 3000;
/** El cliente deja de preguntar a los 10 minutos (el servidor corta antes con su propio motivo). */
export const CLIENT_GIVE_UP_MS = 10 * 60_000;
export const PREPARING_NOTICE = "Preparando tu archivo…";

/** Cada cuánto se vuelve a preguntar: seguido al principio, más espaciado si tarda. */
export function pollDelayMs(attempt: number): number {
  return [1000, 1000, 1500, 2000, 2500][attempt] ?? 4000;
}

export interface ExportProgress {
  /** Si ya hay que mostrar «Preparando tu archivo…». */
  showNotice: boolean;
  /** Si ya no vale la pena seguir esperando. */
  giveUp: boolean;
}

export function exportProgress(elapsedMs: number): ExportProgress {
  return { showNotice: elapsedMs >= PREPARING_NOTICE_MS, giveUp: elapsedMs >= CLIENT_GIVE_UP_MS };
}
