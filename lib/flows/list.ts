/**
 * La lista de automatizaciones: buscar, filtrar por categoria, estado y origen, y lo que dice la URL
 * (auditoria de automatizaciones, oct 2026). Puro: lo usan la pagina (servidor) y la lista (navegador).
 */

import type { FlowStatus } from "@/lib/types/database";
import { categoryKey } from "./categories";
import { matchesQuery } from "./search";

/** De donde viene la automatizacion: la crearon en Automatizaciones o la arma otra pantalla. */
export type FlowOrigin = "manual" | "formularios" | "agenda" | "sistema";

export const FLOW_ORIGIN_LABELS: Record<FlowOrigin, string> = {
  manual: "Creadas acá",
  formularios: "De Formularios",
  agenda: "De la Agenda",
  sistema: "Del sistema (Ventas y cobranza)",
};

export const FLOW_STATUS_LABELS: Record<FlowStatus, string> = { draft: "Borrador", published: "Publicada", archived: "Archivada" };

export function flowOrigin(row: { form_id?: string | null; event_type_id?: string | null; template_key?: string | null }): FlowOrigin {
  if (row.form_id) return "formularios"; // @plantilla-quitar(formularios)
  if (row.event_type_id) return "agenda";
  if (row.template_key) return "sistema";
  return "manual";
}

export interface FlowListRow {
  id: string;
  name: string;
  description: string | null;
  categories: string[];
  status: FlowStatus;
  origin: FlowOrigin;
  /** Como arranca, en palabras ("Se agendó una reunión"). */
  triggerLabel: string;
  stepCount: number;
  updatedAt: string;
  /** Publicada con cambios que todavia no corren. */
  hasDraft: boolean;
  /** Pasos que no se van a ejecutar por una conexion que falta (texto ya armado), si hay. */
  blockedNote: string | null;
}

export interface FlowListQuery {
  q: string;
  status: "all" | FlowStatus;
  origin: "all" | FlowOrigin;
  /** Muestra las que tienen ALGUNA de estas categorias. Vacio = todas. */
  categories: string[];
}

export const EMPTY_FLOW_QUERY: FlowListQuery = { q: "", status: "all", origin: "all", categories: [] };

const STATUSES: FlowStatus[] = ["draft", "published", "archived"];
const ORIGINS: FlowOrigin[] = ["manual", "formularios", "agenda", "sistema"]; // @plantilla-quitar(formularios)
// @plantilla-sin(formularios): const ORIGINS: FlowOrigin[] = ["manual", "agenda", "sistema"];
const STATUS_PARAM: Record<string, FlowStatus> = { borrador: "draft", publicada: "published", archivada: "archived" };
const STATUS_TO_PARAM: Record<FlowStatus, string> = { draft: "borrador", published: "publicada", archived: "archivada" };

/** Lo que dice la URL (`?q=&estado=&origen=&categoria=`), validado: lo que no se entiende se ignora. */
export function parseFlowListQuery(params: Record<string, string | string[] | undefined>): FlowListQuery {
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : "";
  };
  const status = STATUS_PARAM[one("estado")] ?? "all";
  const origin = (ORIGINS as string[]).includes(one("origen")) ? (one("origen") as FlowOrigin) : "all";
  const categories = one("categoria")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 10);
  return { q: one("q").slice(0, 100), status, origin, categories };
}

export function flowListQueryString(query: FlowListQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.status !== "all") params.set("estado", STATUS_TO_PARAM[query.status]);
  if (query.origin !== "all") params.set("origen", query.origin);
  if (query.categories.length > 0) params.set("categoria", query.categories.join(","));
  return params.toString();
}

export function hasActiveFlowFilters(query: FlowListQuery): boolean {
  return query.q.trim() !== "" || query.status !== "all" || query.origin !== "all" || query.categories.length > 0;
}

/** Busqueda por nombre, descripcion, categorias y disparador; filtros por estado, origen y categoria (cualquiera). */
export function filterFlows(rows: FlowListRow[], query: FlowListQuery): FlowListRow[] {
  const wanted = new Set(query.categories.map(categoryKey));
  return rows.filter((row) => {
    if (query.status !== "all" && row.status !== query.status) return false;
    if (query.origin !== "all" && row.origin !== query.origin) return false;
    if (wanted.size > 0 && !row.categories.some((c) => wanted.has(categoryKey(c)))) return false;
    return matchesQuery([row.name, row.description, row.triggerLabel, ...row.categories], query.q);
  });
}

/** Cuantas hay por estado, por origen y por categoria (para los menus). */
export function flowCounts(rows: FlowListRow[]): {
  status: Record<"all" | FlowStatus, number>;
  origin: Record<"all" | FlowOrigin, number>;
  categories: Array<{ name: string; count: number }>;
} {
  const status = { all: rows.length, draft: 0, published: 0, archived: 0 } as Record<"all" | FlowStatus, number>;
  const origin = { all: rows.length, manual: 0, formularios: 0, agenda: 0, sistema: 0 } as Record<"all" | FlowOrigin, number>;
  const byKey = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    if (STATUSES.includes(row.status)) status[row.status] += 1;
    origin[row.origin] += 1;
    for (const c of row.categories) {
      const key = categoryKey(c);
      const entry = byKey.get(key) ?? { name: c, count: 0 };
      entry.count += 1;
      byKey.set(key, entry);
    }
  }
  const categories = [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"));
  return { status, origin, categories };
}
