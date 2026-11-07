/**
 * Los links públicos del Diseñador IA (cambio 1.2 del plano, F43).
 *
 * Todo link que ve o recibe alguien de afuera (`design.link`, "Copiar link", el
 * email de una generación, la descarga, Open Graph) se arma con
 * `publicBaseUrl(workspace)`: el «Dominio de tus links» del negocio si lo
 * tiene, y si no, el principal. Nunca leyendo el dominio principal directo ni
 * el dominio del navegador (docs/dominios.md; lo controla un test de frontera).
 * Los componentes de cliente reciben la URL ya armada como prop.
 *
 * `designPublicUrl` y `designDownloadUrl` son puras; `loadDesignLinks` lee el
 * dominio del negocio (servidor).
 */

import { loadPublicBaseUrl, publicBaseUrl, type WorkspaceDomainSource } from "@/lib/public-url";

/** Un código de diseño: 12 caracteres Crockford base32 en tres grupos (`K8F2-WQ4M-7TQA`). */
export const DESIGN_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Normaliza un código que llega por la URL: mayúsculas; `null` si no tiene la forma. */
export function normalizeDesignCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return DESIGN_CODE_RE.test(code) ? code : null;
}

export type DownloadFormat = "pdf" | "zip" | "png";

export function designPublicUrl(base: string, code: string): string {
  return `${base.replace(/\/+$/, "")}/d/${encodeURIComponent(code)}`;
}

export function designDownloadUrl(base: string, code: string, opts: { formato: DownloadFormat; pagina?: number }): string {
  const params = new URLSearchParams({ formato: opts.formato });
  if (opts.formato === "png" && opts.pagina !== undefined) params.set("pagina", String(opts.pagina));
  return `${designPublicUrl(base, code)}/descargar?${params.toString()}`;
}

export interface DesignLinks {
  link: string;
  pdfUrl: string;
  zipUrl: string;
}

/** Los links de un diseño con el dominio del negocio (para una fila ya leída del workspace). */
export function designLinksFor(workspace: WorkspaceDomainSource, code: string): DesignLinks {
  const base = publicBaseUrl(workspace);
  return { link: designPublicUrl(base, code), pdfUrl: designDownloadUrl(base, code, { formato: "pdf" }), zipUrl: designDownloadUrl(base, code, { formato: "zip" }) };
}

/** Lo mismo leyendo el dominio del negocio de la base (jobs, automatizaciones). Nunca lanza: si falla, el principal. */
export async function loadDesignLinks(db: unknown, workspaceId: string, code: string): Promise<DesignLinks> {
  const base = await loadPublicBaseUrl(db, workspaceId);
  return { link: designPublicUrl(base, code), pdfUrl: designDownloadUrl(base, code, { formato: "pdf" }), zipUrl: designDownloadUrl(base, code, { formato: "zip" }) };
}
