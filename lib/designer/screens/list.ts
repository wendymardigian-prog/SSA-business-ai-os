/**
 * La lista del Diseñador IA (F15, §11.2): filtros ↔ URL, la regla de qué entra en cada pestaña y lo que
 * dice cada tarjeta.
 *
 * Los filtros viven en la URL (se comparten y sobreviven a recargar): `?tab=plantillas&q=…&formato=…&origen=…
 * &archivados=1&pagina=2`. Lo que no se dice, es el valor de siempre y no se escribe.
 *
 * Una generación (un diseño con `template_id`) NO aparece en la lista de Diseños: se ve dentro de cada plantilla.
 * Esa regla es `isOwnDesign` y la usa la consulta (`lib/designer/queries.ts`) y la verificación.
 *
 * Módulo puro.
 */

import { FORMAT_KEYS, FORMATS, isFormatKey, type FormatKey } from "../formats";
import { DOC_TYPE_LABELS, isDocType } from "../verification";

export const LIST_PAGE_SIZE = 48;

export const LIST_TABS = ["disenos", "plantillas"] as const;
export type ListTab = (typeof LIST_TABS)[number];

export const TAB_LABELS: Record<ListTab, string> = { disenos: "Diseños", plantillas: "Plantillas" };

/** La nota de una línea que explica cada pestaña (texto del prototipo, §F15). */
export const TAB_NOTES: Record<ListTab, string> = {
  disenos: "Un diseño es una pieza final: la hacés vos con la IA (un carrusel, una presentación) o la cargás. Puede tener link público y descarga en PDF o imagen.",
  plantillas:
    "Una plantilla tiene variables y sirve para generar piezas en automatizaciones o con «Generar para…». Lo que genera se ve dentro de cada plantilla, en Generaciones, y no ensucia esta lista. La plantilla no tiene link público: solo se exporta de prueba.",
};

/** Lo que se puede filtrar por origen. Es el de la creación: con IA, a mano (imagen o en blanco) o cargado. */
export const ORIGIN_FILTERS = ["all", "ai", "manual", "html"] as const;
export type OriginFilter = (typeof ORIGIN_FILTERS)[number];

export const ORIGIN_FILTER_LABELS: Record<OriginFilter, string> = {
  all: "Todos los orígenes",
  ai: "Hechos con IA",
  manual: "Hechos a mano",
  html: "Cargados (HTML)",
};

/** Los valores de `origin` en la base que corresponden a cada filtro (vacío = no filtra). */
export type OriginValue = "ai" | "blank" | "image" | "html";

export function originValues(filter: OriginFilter): OriginValue[] {
  switch (filter) {
    case "ai":
      return ["ai"];
    case "manual":
      return ["blank", "image"];
    case "html":
      return ["html"];
    default:
      return [];
  }
}

/** La etiqueta de origen de una fila, para su insignia. */
export function originLabel(origin: string): string | null {
  switch (origin) {
    case "ai":
      return "Hecho con IA";
    case "blank":
      return "Hecho a mano";
    case "image":
      return "Desde una imagen";
    case "html":
      return "Cargado (HTML)";
    default:
      return null;
  }
}

export interface ListFilters {
  tab: ListTab;
  q: string;
  format: FormatKey | "all";
  origin: OriginFilter;
  archived: boolean;
  /** Desde 1. */
  page: number;
}

export const DEFAULT_LIST_FILTERS: ListFilters = { tab: "disenos", q: "", format: "all", origin: "all", archived: false, page: 1 };

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function pick(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

const ORIGIN_PARAM: Record<Exclude<OriginFilter, "all">, string> = { ai: "ia", manual: "mano", html: "cargados" };

/** Lee la URL. Todo valor se valida: uno que no existe es el de siempre. */
export function parseListFilters(params: Params): ListFilters {
  const tab = pick(params, "tab");
  const format = pick(params, "formato");
  const origin = pick(params, "origen");
  const page = Number.parseInt(pick(params, "pagina") ?? "1", 10);
  const originKey = (Object.entries(ORIGIN_PARAM).find(([, v]) => v === origin)?.[0] ?? "all") as OriginFilter;
  return {
    tab: tab === "plantillas" ? "plantillas" : "disenos",
    q: (pick(params, "q") ?? "").trim().slice(0, 120),
    format: format && isFormatKey(format) ? format : "all",
    origin: originKey,
    archived: pick(params, "archivados") === "1",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

/** Escribe los filtros como query string (sin el "?"). Lo que es el valor de siempre no se escribe. */
export function listFiltersToQuery(filters: ListFilters): string {
  const params = new URLSearchParams();
  if (filters.tab !== "disenos") params.set("tab", filters.tab);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.format !== "all") params.set("formato", filters.format);
  if (filters.origin !== "all") params.set("origen", ORIGIN_PARAM[filters.origin]);
  if (filters.archived) params.set("archivados", "1");
  if (filters.page > 1) params.set("pagina", String(filters.page));
  return params.toString();
}

/** Cuántos filtros hay puestos (para el aviso "Limpiar filtros"); la pestaña y la página no cuentan. */
export function activeFilterCount(filters: ListFilters): number {
  return (filters.q.trim() ? 1 : 0) + (filters.format !== "all" ? 1 : 0) + (filters.origin !== "all" ? 1 : 0) + (filters.archived ? 1 : 0);
}

/** Cambiar un filtro vuelve a la página 1 (la 3 de otra búsqueda no existe). */
export function withFilter(filters: ListFilters, patch: Partial<Omit<ListFilters, "page">>): ListFilters {
  return { ...filters, ...patch, page: 1 };
}

/** Los formatos que ofrece el filtro: los de las plantillas no incluyen `web` (una plantilla no es una página web). */
export function formatFilterOptions(tab: ListTab): FormatKey[] {
  return FORMAT_KEYS.filter((key) => tab === "disenos" || key !== "web");
}

/**
 * Si una fila de `designs` es un diseño PROPIO. Una generación tiene `template_id` y no se lista acá: se ve dentro de
 * su plantilla (F15). La consulta de la lista aplica esta misma regla en la base (`template_id IS NULL`).
 */
export function isOwnDesign(row: { template_id: string | null }): boolean {
  return row.template_id === null;
}

// ─── Lo que dice cada tarjeta ────────────────────────────────────────────────

export interface CardRow {
  id: string;
  kind: "design" | "template";
  name: string;
  format: FormatKey;
  origin: string;
  pages: number;
  updatedAt: string;
  archived: boolean;
  /** Solo diseños. */
  published?: boolean;
  /** Solo plantillas. */
  variables?: number;
  generated?: number;
  verify?: boolean;
  docType?: string | null;
  docTypeLabel?: string | null;
}

export type BadgeTone = "ok" | "off" | "pur" | "warn";

export interface CardBadge {
  label: string;
  tone: BadgeTone;
}

export interface CardView {
  id: string;
  kind: CardRow["kind"];
  href: string;
  name: string;
  badges: CardBadge[];
  /** "N páginas", solo con más de una (el sello de la esquina de la miniatura). */
  pagesLabel: string | null;
  /** "Vertical 4:5 · imagen · hoy 09:12". */
  metaLine: string;
  archived: boolean;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

function localParts(date: Date, timeZone: string): { y: number; m: number; d: number; hh: string; mm: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: get("hour"), mm: get("minute") };
}

const dayNumber = (p: { y: number; m: number; d: number }) => Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);

/** "hoy 09:41", "ayer 18:20", "5 oct" o "12 mar 2025", en la zona de quien mira. */
export function whenLabel(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const a = localParts(at, timeZone);
  const n = localParts(now, timeZone);
  const diff = dayNumber(n) - dayNumber(a);
  if (diff === 0) return `hoy ${a.hh}:${a.mm}`;
  if (diff === 1) return `ayer ${a.hh}:${a.mm}`;
  return `${a.d} ${MONTHS[a.m - 1]}${a.y !== n.y ? ` ${a.y}` : ""}`;
}

/** Qué exporta el formato, en una palabra para la línea de la tarjeta. */
function exportWord(format: FormatKey, kind: CardRow["kind"]): string {
  const def = FORMATS[format];
  if (def.primaryExport === "none") return "Se comparte con link";
  const ext = def.primaryExport === "pdf" ? "PDF" : "imagen";
  return kind === "template" ? `Exporta ${ext}` : ext;
}

export function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Lo que muestra una tarjeta de la lista: sus insignias, la línea de formato y fecha y adónde lleva. */
export function cardView(row: CardRow, opts: { now: Date; timeZone: string }): CardView {
  const badges: CardBadge[] = [];
  if (row.kind === "template") {
    badges.push({ label: "Plantilla", tone: "pur" });
    badges.push({ label: pluralize(row.variables ?? 0, "variable", "variables"), tone: "off" });
    if (row.verify) {
      const type = isDocType(row.docType) ? (row.docType === "otro" ? (row.docTypeLabel ?? "Otro") : DOC_TYPE_LABELS[row.docType]) : null;
      badges.push({ label: type ? `Se verifica · ${type}` : "Se verifica", tone: "ok" });
    }
    if (row.origin === "image") badges.push({ label: "Desde una imagen", tone: "off" });
    badges.push({ label: pluralize(row.generated ?? 0, "generado", "generados"), tone: "off" });
  } else {
    badges.push(row.published ? { label: "Publicado", tone: "ok" } : { label: "Borrador", tone: "off" });
    const origin = originLabel(row.origin);
    if (origin) badges.push({ label: origin, tone: "off" });
  }
  if (row.archived) badges.push({ label: "Archivado", tone: "warn" });
  const when = whenLabel(row.updatedAt, opts.now, opts.timeZone);
  return {
    id: row.id,
    kind: row.kind,
    href: row.kind === "template" ? `/dashboard/disenos/t/${row.id}` : `/dashboard/disenos/d/${row.id}`,
    name: row.name,
    badges,
    pagesLabel: row.pages > 1 ? `${row.pages} páginas` : null,
    metaLine: [FORMATS[row.format].label, exportWord(row.format, row.kind), when].filter(Boolean).join(" · "),
    archived: row.archived,
  };
}

/** Cuántas páginas de 48 hay para `total` filas (mínimo 1). */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
}

/** El rango (desde, hasta) de una página de 48, para `.range()`. */
export function pageRange(page: number): { from: number; to: number } {
  const from = (Math.max(page, 1) - 1) * LIST_PAGE_SIZE;
  return { from, to: from + LIST_PAGE_SIZE - 1 };
}

/** El texto del estado vacío de la pestaña, con su acción. */
export function emptyState(tab: ListTab, filtered: boolean): { title: string; text: string } {
  if (filtered) return { title: tab === "disenos" ? "Ningún diseño coincide" : "Ninguna plantilla coincide", text: "Probá con otra búsqueda o sacá algún filtro." };
  return tab === "disenos"
    ? { title: "Todavía no hay diseños", text: "Creá el primero con IA o subí una imagen." }
    : { title: "Todavía no hay plantillas", text: "Una plantilla tiene variables y genera piezas solas, como un certificado para cada estudiante." };
}
