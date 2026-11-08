/**
 * Lo que decide la página pública `/d/<código>` (F43), sin tocar la base ni el navegador.
 *
 * Todo sale de lo que devuelve `design_public_get` (que ya se negó a mostrar un código inexistente, un borrador
 * o algo que no se puede ver). Acá se decide QUÉ se muestra de eso:
 *
 * - una pieza (PNG de cada página) o una página web (iframe) o "Se está preparando";
 * - el recuadro de verificación (válido o anulado), con el texto de su tipo de documento;
 * - si se puede descargar, y qué;
 * - si los buscadores pueden indexarla (solo una `web` publicada con "Permitir que aparezca en buscadores").
 *
 * `design_public_get` devuelve una generación con verificación en CUALQUIER estado; la página muestra solo una
 * `ready` (válida) o `void` (anulada, con su motivo). `queued`, `rendering` y `failed` muestran "Se está
 * preparando", sin datos y sin Descargar (nunca se cuenta que falló).
 *
 * Módulo puro.
 */

import { FORMATS, isFormatKey, type FormatKey } from "../formats";
import { formatDesignDate } from "../variables/catalog";
import { isDocType, verificationText, verificationTitle, type DocType } from "../verification";
import { primaryDownload, type DownloadOption } from "./download";

export type PublicStatus = "draft" | "queued" | "rendering" | "ready" | "failed" | "void";

const STATUSES: readonly PublicStatus[] = ["draft", "queued", "rendering", "ready", "failed", "void"];

/** Lo que devuelve `design_public_get`, ya revisado. */
export interface PublicDesign {
  code: string;
  name: string;
  format: FormatKey;
  kind: "design" | "generation";
  status: PublicStatus;
  published: boolean;
  allowDownload: boolean;
  allowIndexing: boolean;
  issuedAt: string | null;
  verify: boolean;
  docType: DocType | null;
  docTypeLabel: string | null;
  voidReason: string | null;
  pageCount: number;
  /** Si ya hay un juego de archivos renderizado (PNG y PDF). */
  rendered: boolean;
  renderedVersion: string | null;
  businessName: string;
  businessTimezone: string;
  /** Solo una página web propia: su documento. */
  doc: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Revisa la respuesta de `design_public_get`. Algo que no tiene la forma esperada es `null` (404). */
export function parsePublicDesign(raw: unknown): PublicDesign | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const code = str(r.code);
  const name = str(r.name);
  const status = r.status;
  const pageCount = r.page_count;
  if (!code || name === null || !isFormatKey(r.format) || (r.kind !== "design" && r.kind !== "generation")) return null;
  if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) return null;
  if (typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 1) return null;
  const docType = isDocType(r.doc_type) ? r.doc_type : null;
  return {
    code,
    name,
    format: r.format,
    kind: r.kind,
    status: status as PublicStatus,
    published: r.published === true,
    allowDownload: r.allow_download === true,
    allowIndexing: r.allow_indexing === true,
    issuedAt: str(r.issued_at),
    verify: r.verify === true,
    docType,
    docTypeLabel: str(r.doc_type_label),
    voidReason: str(r.void_reason),
    pageCount,
    rendered: r.rendered === true,
    renderedVersion: typeof r.rendered_version === "string" ? r.rendered_version : null,
    businessName: str(r.business_name)?.trim() || "Diseño",
    businessTimezone: str(r.business_timezone) || "UTC",
    doc: r.doc ?? null,
  };
}

/** Lo que guarda `designs.renders` y la ruta de cada archivo, ya revisado contra la carpeta del diseño. */
export interface PublicRenders {
  version: string | null;
  pdfPath: string | null;
  pages: string[];
}

/**
 * Revisa `designs.renders`. Una ruta que no es de la carpeta de ESTE diseño (`<ws>/<diseño>/…`) se descarta:
 * nunca se sirve un archivo de otro diseño por un dato mal guardado.
 */
export function parseRenders(raw: unknown, workspaceId: string, designId: string): PublicRenders | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const prefix = `${workspaceId}/${designId}/`;
  const mine = (p: unknown): p is string => typeof p === "string" && p.startsWith(prefix) && !p.includes("..") && !p.includes("//") && !p.slice(prefix.length).startsWith("exports/");
  const pages = Array.isArray(r.pages) ? r.pages.filter(mine) : [];
  const pdfPath = mine(r.pdf_path) ? r.pdf_path : null;
  if (pages.length === 0 && !pdfPath) return null;
  return { version: typeof r.version === "string" ? r.version : null, pdfPath, pages };
}

// ─── Qué se muestra ─────────────────────────────────────────────────────────

export const PREPARING_TITLE = "Se está preparando";
export const PREPARING_TEXT = "Este diseño todavía no está listo. Vuelve a probar en unos segundos.";

export interface VerificationBoxView {
  status: "valid" | "void";
  /** "Certificado válido", "Constancia anulada", "Verificado"… */
  title: string;
  /** El recuadro entero, como lo manda el plano: "✅ Certificado válido · emitido por … el … · Código …". */
  text: string;
  reason: string | null;
}

export interface PublicView {
  /** `pieces`: las páginas como imágenes. `web`: un iframe. `preparing`: todavía no hay nada que mostrar. */
  screen: "pieces" | "web" | "preparing";
  /** El recuadro de arriba (null si no es una pieza con verificación ni una anulada). */
  verification: VerificationBoxView | null;
  /** Sello «ANULADO» sobre la pieza. */
  voidStamp: boolean;
  download: {
    /** Si el link deja bajar el archivo (aunque todavía no esté renderizado: ahí se encola y se responde 202). */
    allowed: boolean;
    /** Si el archivo ya está (el botón solo se dibuja entonces). */
    ready: boolean;
    option: DownloadOption | null;
  };
  /** Si los buscadores pueden indexarla. */
  indexable: boolean;
  /** Ancho máximo de la pieza en px (760 en verticales, 1000 en horizontales; una web usa el suyo). */
  maxWidth: number;
  /** Si el título, la descripción y la tarjeta pueden llevar el nombre de la pieza (no, mientras se prepara). */
  showName: boolean;
}

const WEB_MAX_WIDTH = FORMATS.web.width;

/** Ancho máximo de la pieza: 760 px para verticales y cuadradas, 1000 px para horizontales. */
export function pieceMaxWidth(format: FormatKey): number {
  if (format === "web") return WEB_MAX_WIDTH;
  const def = FORMATS[format];
  return def.height >= def.width ? 760 : 1000;
}

/** La fecha de emisión en la zona del negocio ("7 de noviembre de 2026"). Una zona rota cae en UTC. */
export function issuedDate(issuedAt: string | null, timezone: string): string {
  const date = issuedAt ? new Date(issuedAt) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return formatDesignDate(date, "long", timezone);
  } catch {
    return formatDesignDate(date, "long", "UTC");
  }
}

function verificationFor(d: PublicDesign): VerificationBoxView | null {
  if (d.kind !== "generation") return null;
  if (d.status !== "ready" && d.status !== "void") return null;
  // Una pieza anulada se muestra anulada aunque su plantilla ya no verifique: el recuadro dice «Anulado».
  if (d.status === "ready" && !d.verify) return null;
  const type = d.verify ? d.docType : null;
  const label = d.verify ? d.docTypeLabel : null;
  const status = d.status === "void" ? "void" : "valid";
  const date = issuedDate(d.issuedAt, d.businessTimezone);
  return {
    status,
    title: verificationTitle(type, status),
    text: verificationText(type, label, status, d.businessName, date, d.code, d.voidReason),
    reason: status === "void" ? d.voidReason?.trim() || "sin motivo" : null,
  };
}

export function decidePublicView(d: PublicDesign): PublicView {
  const generation = d.kind === "generation";
  // Una generación solo se muestra lista (`ready`) o anulada (`void`); en cualquier otro estado, "Se está preparando".
  const settled = d.status === "ready" || d.status === "void";
  const maxWidth = pieceMaxWidth(d.format);
  const preparing = (extra: Partial<PublicView> = {}): PublicView => ({
    screen: "preparing",
    verification: null,
    voidStamp: false,
    download: { allowed: false, ready: false, option: null },
    indexable: false,
    maxWidth,
    showName: false,
    ...extra,
  });

  if (generation && !settled) return preparing();
  if (!generation && !d.published) return preparing();

  const verification = verificationFor(d);
  const voided = d.status === "void";
  const web = d.format === "web";

  const option = primaryDownload(d.format, d.pageCount);
  // Una generación se baja lista (`ready`); un diseño propio publicado, mientras no esté anulado. Una anulada, nunca.
  const live = generation ? d.status === "ready" : d.status !== "void";
  const allowed = !!option && d.allowDownload && live && !web;
  const download = { allowed, ready: allowed && d.rendered, option: allowed ? option : null };

  if (web) {
    // Una página web se muestra desde su documento (solo la propia y publicada). Sin documento, no hay nada que mostrar.
    if (generation || d.doc === null) return preparing({ verification });
    return {
      screen: "web",
      verification,
      voidStamp: false,
      download: { allowed: false, ready: false, option: null },
      indexable: d.published && d.allowIndexing && live,
      maxWidth,
      showName: true,
    };
  }

  return {
    screen: d.rendered ? "pieces" : "preparing",
    verification,
    voidStamp: voided && d.rendered,
    download,
    indexable: false,
    maxWidth,
    showName: true,
  };
}

/** Un iframe sandbox sin scripts: los links abren en una pestaña nueva en vez de cargar otra página adentro. */
export function withBaseTarget(html: string): string {
  return html.replace(/<head>/i, '<head><base target="_blank">');
}

/** El título de la pestaña y de la tarjeta. Mientras se prepara no se dice el nombre de la pieza. */
export function publicTitle(d: PublicDesign, view: PublicView): string {
  return view.showName && d.name.trim() ? d.name.trim() : "Diseño";
}

/** La línea de la tarjeta: el texto de la verificación o, si no hay, el nombre del negocio. */
export function publicDescription(d: PublicDesign, view: PublicView): string {
  return view.verification?.text ?? d.businessName;
}
