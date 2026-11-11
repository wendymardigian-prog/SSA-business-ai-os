/**
 * Las vistas guardadas de una tabla: qué guarda una vista, cuál está activa según la URL y cómo se llega a ella. PURO.
 *
 * Una vista guarda las columnas (`TablePrefs`) y los filtros (el texto de la URL: `estado=paid&producto=…`). La vista activa
 * vive en la URL como `?vista=<id>`; `?vista=base` es «la de sistema» (todo normal), sin vista predeterminada.
 *
 * Quién ve, quién edita y quién puede dejar una vista como predeterminada de otra persona lo decide la base (migración
 * 00360); acá solo se espeja para dibujar la pantalla sin ofrecer lo que la base rechazaría.
 */
import { emptyPrefs, normalizePrefs, parsePrefs, type ColumnMeta, type TablePrefs } from "./prefs";

export const VIEW_PARAM = "vista";
/** «Vista del sistema»: las columnas y los filtros normales, aunque haya una vista predeterminada. */
export const BASE_VIEW = "base";

export const VIEW_VISIBILITIES = ["private", "workspace", "selected"] as const;
export type ViewVisibility = (typeof VIEW_VISIBILITIES)[number];

export const VISIBILITY_LABELS: Record<ViewVisibility, string> = {
  private: "Solo yo",
  workspace: "Todo el equipo",
  selected: "Personas elegidas",
};

export const VIEW_NAME_MAX = 60;

export interface TableViewConfig {
  v: 1;
  columns: TablePrefs;
  /** Los filtros de la URL, ordenados y sin la página ni la búsqueda. */
  filters: string;
}

export interface TableViewItem {
  id: string;
  name: string;
  ownerId: string;
  visibility: ViewVisibility;
  config: TableViewConfig;
  /** Con `selected`: a quién se le muestra (solo lo ve quien administra la vista). */
  memberIds: string[];
  /** Para quién es la predeterminada. Quien administra ve a todos; el resto, solo a sí mismo. */
  defaultFor: string[];
}

const isVisibility = (value: unknown): value is ViewVisibility => (VIEW_VISIBILITIES as readonly unknown[]).includes(value);
export const parseVisibility = (value: unknown): ViewVisibility => (isVisibility(value) ? value : "private");

/** Los parámetros que no son «un filtro»: no forman parte de una vista. */
const NOT_A_FILTER = new Set([VIEW_PARAM, "pagina", "q"]);

/** Los filtros de la URL en una forma estable para comparar y guardar. */
export function viewFilterString(params: URLSearchParams | string): string {
  const source = typeof params === "string" ? new URLSearchParams(params) : params;
  const pairs: Array<[string, string]> = [];
  source.forEach((value, key) => {
    if (!NOT_A_FILTER.has(key) && value !== "") pairs.push([key, value]);
  });
  pairs.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  return new URLSearchParams(pairs).toString().slice(0, 2000);
}

export function buildViewConfig(columns: TablePrefs, filters: string): TableViewConfig {
  return { v: 1, columns, filters: viewFilterString(filters) };
}

/** Lo guardado, sin confiar en él. */
export function parseViewConfig(raw: unknown, metas?: readonly ColumnMeta[]): TableViewConfig {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const parsed = parsePrefs(o.columns);
  return {
    v: 1,
    columns: metas ? normalizePrefs(metas, parsed) : parsed,
    filters: typeof o.filters === "string" ? viewFilterString(o.filters) : "",
  };
}

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export interface ActiveView {
  /** La vista cuyas columnas se aplican (null = las de sistema). */
  active: TableViewItem | null;
  /** Lo que va en `?vista=` al armar un link de esta pantalla (null = no poner nada). */
  viewParam: string | null;
  /** Los filtros de la vista, cuando hay que aplicarlos porque la URL venía sin nada. */
  inheritedFilters: string | null;
}

/**
 * Qué vista manda en esta carga de la pantalla.
 *  - `?vista=base`: la de sistema.
 *  - `?vista=<id>` de una vista que esta persona ve: esa. Sus filtros se aplican solo si la URL no trae otros.
 *  - sin `?vista=`: la predeterminada de la persona. Sus filtros se aplican solo si la URL llegó pelada (por ejemplo desde el
 *    menú): un link con filtros nunca se pisa.
 */
export function resolveActiveView(views: readonly TableViewItem[], defaultViewId: string | null, sp: SearchParams): ActiveView {
  const requested = first(sp[VIEW_PARAM]);
  const others = Object.keys(sp).some((key) => key !== VIEW_PARAM && sp[key] !== undefined && sp[key] !== "");
  if (requested === BASE_VIEW) return { active: null, viewParam: BASE_VIEW, inheritedFilters: null };
  const chosen = requested ? views.find((v) => v.id === requested) : undefined;
  if (chosen) return { active: chosen, viewParam: chosen.id, inheritedFilters: null };
  const fallback = defaultViewId ? views.find((v) => v.id === defaultViewId) : undefined;
  if (!fallback) return { active: null, viewParam: null, inheritedFilters: null };
  return { active: fallback, viewParam: fallback.id, inheritedFilters: !requested && !others && fallback.config.filters ? fallback.config.filters : null };
}

/** El link a una vista: su id y, solo al elegirla, sus filtros (la URL es la verdad de lo que se está mirando). */
export function viewHref(pathname: string, view: Pick<TableViewItem, "id" | "config"> | null): string {
  const params = new URLSearchParams(view ? view.config.filters : "");
  params.set(VIEW_PARAM, view ? view.id : BASE_VIEW);
  return `${pathname}?${params.toString()}`;
}

/** Suma `?vista=` a los parámetros de un link de la pantalla. */
export function withViewParam(params: URLSearchParams, viewParam: string | null): URLSearchParams {
  if (viewParam) params.set(VIEW_PARAM, viewParam);
  return params;
}

export function validateViewName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Poné un nombre para la vista." };
  if (name.length > VIEW_NAME_MAX) return { ok: false, error: `El nombre puede tener hasta ${VIEW_NAME_MAX} letras.` };
  return { ok: true, name };
}

/** ¿Esta persona puede editar o borrar la vista? Espeja la regla de la base (la dueña, o Owner/Admin si no es privada). */
export function canManageView(view: Pick<TableViewItem, "ownerId" | "visibility">, userId: string, isAdmin: boolean): boolean {
  return view.ownerId === userId || (isAdmin && view.visibility !== "private");
}

/** Los textos de una vista para el menú: con quién se comparte. */
export function visibilityLine(view: Pick<TableViewItem, "visibility" | "memberIds">): string {
  if (view.visibility === "workspace") return "Todo el equipo";
  if (view.visibility === "selected") return view.memberIds.length === 1 ? "1 persona" : `${view.memberIds.length} personas`;
  return "Solo vos";
}

export const defaultViewConfig = (): TableViewConfig => ({ v: 1, columns: emptyPrefs(), filters: "" });
