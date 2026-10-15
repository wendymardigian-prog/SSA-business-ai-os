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
  /**
   * «Pautadas» (con algún anuncio vinculado) o «No pautadas». Ausente = todas. Es opcional a propósito: el valor por
   * defecto no existe en el objeto, así que nada que ya armaba filtros cambia (Tirón 2, A2).
   */
  paid?: "si" | "no";
  /**
   * Responsable de la pieza (Extra I, F43), por id; varios a la vez (`?responsable=a,b`). Es el `assigned_to`, no el
   * autor (`author`, que sigue filtrando por quien la creo). `NO_RESPONSIBLE` ("none") es «sin responsable». Ausente =
   * todos: opcional a proposito, igual que `paid`, para que nada que ya armaba filtros cambie.
   */
  responsible?: string[];
}

/** El valor del filtro de Responsable que significa «piezas sin responsable». */
export const NO_RESPONSIBLE = "none";
const MAX_RESPONSIBLE = 30;

const VIEWS: ContentView[] = ["kanban", "calendar", "list"];

const STATUSES: ContentPostStatus[] = [
  "draft", "in_production", "in_review", "approved",
  "scheduled", "publishing", "published", "partially_published", "failed",
];

/**
 * Los responsables de la URL: `?responsable=a,b` o repetido (`?responsable=a&responsable=b`). Sin repetidos, sin vacios
 * y con tope, para que una URL armada a mano no cree un filtro enorme.
 */
export function parseResponsibleParam(raw: string | string[] | null | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? ""]).flatMap((value) => value.split(","));
  const ids = parts.map((part) => part.trim()).filter((part) => part !== "");
  return [...new Set(ids)].slice(0, MAX_RESPONSIBLE);
}

/** Suma o saca una persona del filtro (para las casillas del menu). */
export function toggleResponsible(current: readonly string[] | undefined, id: string): string[] {
  const list = current ?? [];
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(0, MAX_RESPONSIBLE);
}

/** Lee los filtros de la URL. Lo que no entiende, lo ignora. */
export function parseContentFilters(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): ContentFilters {
  const get = (key: string): string | null => {
    const raw = params instanceof URLSearchParams ? params.get(key) : params[key];
    // Un parametro repetido llega como lista desde Next: para los filtros de un solo valor manda el primero.
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  };
  const responsible = parseResponsibleParam(
    params instanceof URLSearchParams ? params.getAll("responsable") : params.responsable,
  );

  const view = get("vista");
  const status = get("estado");
  const month = get("mes");
  const count = get("contar");
  const paid = get("pautada");

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
    // Un valor inventado no filtra por nada (igual que el estado): no vacía la lista sin explicación.
    ...(paid === "si" || paid === "no" ? { paid } : {}),
    ...(responsible.length > 0 ? { responsible } : {}),
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
  if (filters.paid) params.set("pautada", filters.paid);
  if (filters.responsible && filters.responsible.length > 0) params.set("responsable", filters.responsible.join(","));
  return params.toString();
}

/**
 * Si algo (una idea o una pieza) entra en el filtro de Red de la barra
 * superior (F98): sin red elegida entra todo; con una, lo que apunta a ella.
 */
export function matchesPlatform(platforms: string[], platform: string | null): boolean {
  return platform === null || platforms.includes(platform);
}

export interface FilterablePost {
  id: string;
  title: string;
  status: ContentPostStatus;
  createdBy: string | null;
  /** El responsable de la pieza (`assigned_to`). Una idea no tiene: null. */
  assignedTo?: string | null;
  platforms: string[];
  /** La fecha más temprana de sus redes, para el filtro de mes (C15). */
  firstAt?: string | null;
  /** Si tiene al menos un anuncio vinculado (A2). Una idea nunca la tiene. */
  paid?: boolean;
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
    if (filters.responsible && filters.responsible.length > 0) {
      const mine = post.assignedTo ?? null;
      const match = mine === null ? filters.responsible.includes(NO_RESPONSIBLE) : filters.responsible.includes(mine);
      if (!match) return false;
    }
    if (filters.platform && !post.platforms.includes(filters.platform)) return false;
    if (needle && !post.title.toLowerCase().includes(needle)) return false;
    if (filters.paid === "si" && !post.paid) return false;
    if (filters.paid === "no" && post.paid) return false;

    // El mes filtra por la primera fecha de la pieza (C15). Una sin fecha no
    // pertenece a ningún mes: no se esconde por eso, se esconde porque no
    // sale todavía, y eso ya lo dice el estado.
    if (filters.month) {
      if (!post.firstAt) return false;
      if (!post.firstAt.startsWith(filters.month)) return false;
    }

    return true;
  });
}

/**
 * Cuantos filtros hay puestos, para el contador del boton.
 *
 * El mes no cuenta: en el calendario es donde estas parado, no un filtro, y
 * decir "1 filtro" por estar en octubre no ayuda a nadie. En la lista si
 * filtra, pero ahi se ve su selector con el valor puesto.
 */
export function activeFilterCount(filters: ContentFilters): number {
  return [
    filters.platform,
    filters.status,
    filters.author,
    filters.q,
    filters.paid,
    filters.responsible && filters.responsible.length > 0 ? "responsable" : null,
  ].filter(Boolean).length;
}
