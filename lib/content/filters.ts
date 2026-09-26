/**
 * Los filtros de la vista lista y del calendario (F21).
 *
 * El estado vive en la URL, como en la bandeja y en los dashboards: asi un
 * filtro se comparte con un link y el boton "atras" hace lo que se espera.
 *
 * Todo puro: parsear, aplicar y volver a serializar.
 */

import type { ContentPostStatus } from "@/lib/types/database";

export type ContentView = "kanban" | "calendar" | "list";

export interface ContentFilters {
  view: ContentView;
  /** Red, o "todas". */
  platform: string | null;
  status: ContentPostStatus | null;
  /** Autor, por id. */
  author: string | null;
  /** Mes que se mira en el calendario: "2026-10". */
  month: string | null;
  /** Que se cuenta en el resumen del calendario. */
  count: "pieces" | "publications";
  /** Busqueda por titulo. */
  q: string | null;
}

const VIEWS: ContentView[] = ["kanban", "calendar", "list"];

const STATUSES: ContentPostStatus[] = [
  "draft", "in_production", "in_review", "approved",
  "scheduled", "publishing", "published", "partially_published", "failed",
];

/** Lee los filtros de la URL. Lo que no entiende, lo ignora. */
export function parseContentFilters(params: URLSearchParams | Record<string, string | undefined>): ContentFilters {
  const get = (key: string): string | null => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  };

  const view = get("vista");
  const status = get("estado");
  const month = get("mes");
  const count = get("contar");

  return {
    view: VIEWS.includes(view as ContentView) ? (view as ContentView) : "kanban",
    platform: get("red"),
    // Un estado inventado en la URL no filtra por nada en vez de vaciar la
    // lista sin explicacion.
    status: STATUSES.includes(status as ContentPostStatus) ? (status as ContentPostStatus) : null,
    author: get("autor"),
    month: month && /^\d{4}-\d{2}$/.test(month) ? month : null,
    count: count === "publications" ? "publications" : "pieces",
    q: get("q"),
  };
}

/** Los vuelve a la URL, omitiendo lo que esta en su valor por defecto. */
export function contentFiltersToQuery(filters: ContentFilters): string {
  const params = new URLSearchParams();
  if (filters.view !== "kanban") params.set("vista", filters.view);
  if (filters.platform) params.set("red", filters.platform);
  if (filters.status) params.set("estado", filters.status);
  if (filters.author) params.set("autor", filters.author);
  if (filters.month) params.set("mes", filters.month);
  if (filters.count !== "pieces") params.set("contar", filters.count);
  if (filters.q) params.set("q", filters.q);
  return params.toString();
}

export interface FilterablePost {
  id: string;
  title: string;
  status: ContentPostStatus;
  createdBy: string | null;
  platforms: string[];
}

/** Aplica los filtros a una lista de piezas. */
export function applyContentFilters<T extends FilterablePost>(
  posts: T[],
  filters: ContentFilters,
): T[] {
  const needle = filters.q?.toLowerCase() ?? null;

  return posts.filter((post) => {
    if (filters.status && post.status !== filters.status) return false;
    if (filters.author && post.createdBy !== filters.author) return false;
    if (filters.platform && !post.platforms.includes(filters.platform)) return false;
    if (needle && !post.title.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** Cuantos filtros hay puestos, para el contador del boton. */
export function activeFilterCount(filters: ContentFilters): number {
  return [filters.platform, filters.status, filters.author, filters.q].filter(Boolean).length;
}
