/**
 * Miniaturas EN VIVO (F48, cambio 1.4 del plano).
 *
 * No hay miniaturas renderizadas ni guardadas: la tarjeta de la lista, el
 * historial de versiones y los selectores dibujan la página 1 con
 * `renderPageHTML` reducido, en un contenedor escalado. Así guardar una versión
 * no encola ningún render y la lista no depende del servicio de render.
 *
 * Esto es lo puro: la escala, el tamaño de la caja y el HTML de la miniatura.
 * El componente (`components/designer/list/live-thumb.tsx`) solo lo pone en un
 * `iframe srcdoc` con `sandbox` (sin `allow-scripts`).
 *
 * Módulo puro.
 */

import type { DesignDoc } from "../doc/schema";
import type { UploadedFont } from "../fonts";
import { FORMATS } from "../formats";
import { renderPageHTML } from "../render/page-html";
import { variableInfo, type CustomVar } from "../variables/catalog";

export interface ThumbBox {
  width: number;
  height: number;
}

export interface ThumbSize {
  /** Ancho y alto de diseño de la página (lo que dibuja el `iframe`). */
  designWidth: number;
  designHeight: number;
  /** La escala que lo reduce al contenedor. */
  scale: number;
  /** Lo que ocupa ya reducido, en px de pantalla. */
  width: number;
  height: number;
}

/** El alto de diseño de la página: el de su formato, o el propio en una página web. */
export function pageDesignHeight(doc: Pick<DesignDoc, "format" | "pages">, pageIndex: number): number {
  const format = FORMATS[doc.format];
  return doc.format === "web" ? (doc.pages[pageIndex]?.height ?? format.height) : format.height;
}

/**
 * La escala que entra en la caja sin recortar (la página completa se ve). Una
 * página web muy alta se muestra por su parte de arriba: se escala por ancho
 * y el contenedor la recorta.
 */
export function thumbSize(doc: Pick<DesignDoc, "format" | "pages">, pageIndex: number, box: ThumbBox): ThumbSize {
  const designWidth = FORMATS[doc.format].width;
  const designHeight = pageDesignHeight(doc, pageIndex);
  const web = doc.format === "web";
  const scale = web ? box.width / designWidth : Math.min(box.width / designWidth, box.height / designHeight);
  const safe = Math.max(scale, 0.0001);
  const width = Math.round(designWidth * safe);
  const height = web ? Math.min(Math.round(designHeight * safe), box.height) : Math.round(designHeight * safe);
  return { designWidth, designHeight, scale: safe, width, height };
}

export interface ThumbInput {
  doc: DesignDoc;
  pageIndex?: number;
  /** Las URLs firmadas de los archivos de la página (ruta → link). Una ruta sin link queda vacía. */
  assetUrls?: Readonly<Record<string, string>>;
  customVars?: readonly CustomVar[];
  /** Las fuentes subidas del negocio (las demás las pide Google). */
  uploadedFonts?: readonly UploadedFont[];
}

/** De las fuentes subidas, las que usa esta página (solo esas hace falta firmar y cargar). */
export function usedUploadedFonts(doc: DesignDoc, pageIndex: number, uploaded: readonly UploadedFont[]): UploadedFont[] {
  const page = doc.pages[pageIndex];
  if (!page) return [];
  const families = new Set(page.elements.flatMap((el) => (el.type === "text" ? [el.font.family] : [])));
  return uploaded.filter((font) => families.has(font.family));
}

/**
 * El HTML de la miniatura: la MISMA función que el lienzo, el link público y el
 * servicio de render. En modo `edit` (con las variables como chips), sin
 * ocultos. Nunca contiene `<script`.
 */
export function thumbHtml(input: ThumbInput): string {
  const pageIndex = input.pageIndex ?? 0;
  const index = input.doc.pages[pageIndex] ? pageIndex : 0;
  return renderPageHTML(input.doc, index, {
    mode: "edit",
    assetUrl: (path) => input.assetUrls?.[path] ?? "",
    uploadedFonts: input.uploadedFonts,
    variableLabel: (key) => variableInfo(key, { customVars: input.customVars }).label,
  });
}

/** Las rutas de archivos (imágenes del fondo y de los elementos) que usa UNA página, para firmarlas de una vez. */
export function collectAssetPathsOf(doc: DesignDoc, pageIndex: number): string[] {
  const page = doc.pages[pageIndex];
  if (!page) return [];
  const paths = new Set<string>();
  if (page.background.type === "image" && page.background.image) paths.add(page.background.image.asset);
  for (const el of page.elements) {
    if (el.type === "image") paths.add(el.asset);
    if (el.type === "html") for (const m of `${el.html}\n${el.css ?? ""}`.matchAll(/asset:([A-Za-z0-9._\-/]+)/g)) paths.add(m[1]);
  }
  return [...paths];
}

/** Un documento reducido a su primera página (lo que viaja al navegador desde la lista). */
export function firstPageDoc(doc: DesignDoc): DesignDoc {
  return { ...doc, pages: doc.pages.slice(0, 1) };
}

/** El punto ámbar de la revisión automática (F36): qué decir y cuántos problemas quedaron en esa página. */
export interface QaBadge {
  label: string;
  issues: number;
}

export const QA_BADGE_LABEL = "Revisión automática: hay algo para mirar";

/**
 * Si la página `pageIndex` (0 = la primera) tiene algo que la revisión automática no pudo resolver. Lee `designs.last_qa`
 * tal como viene de la base (`{ at, issues: [{ kind, page }], unchecked }`) sin lanzar: algo raro o vacío es «sin punto».
 */
export function qaBadge(lastQa: unknown, pageIndex: number): QaBadge | null {
  if (!lastQa || typeof lastQa !== "object" || Array.isArray(lastQa)) return null;
  const issues = (lastQa as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return null;
  const count = issues.filter((i) => !!i && typeof i === "object" && (i as { page?: unknown }).page === pageIndex).length;
  return count > 0 ? { label: QA_BADGE_LABEL, issues: count } : null;
}
