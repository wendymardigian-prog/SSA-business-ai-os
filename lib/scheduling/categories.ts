/**
 * Categorías de agenda (F50, F51): dos niveles, área y tipo. Lo que se
 * decide sin base: resolver la categoría de un evento o una agenda a
 * `{area, type}`, validar nombres y armar el snapshot que copia la agenda.
 */

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  position: number;
  is_system: boolean;
  archived_at: string | null;
}

export interface ResolvedCategory {
  area: CategoryRow | null;
  type: CategoryRow | null;
}

export const CATEGORY_NAME_MAX = 40;

/** Colores de las áreas (la misma paleta que los eventos). */
export const AREA_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488"] as const;

/** Las áreas y tipos que se precargan por workspace (00097). */
export const SYSTEM_AREAS = [
  { name: "Ventas", color: "#2563eb", types: ["Triaje", "Cierre", "Seguimiento"] },
  { name: "Servicio", color: "#0d9488", types: ["Onboarding", "Uno a uno"] },
] as const;

/**
 * `categoryId` puede ser un área o un tipo. Devuelve el área siempre (la del
 * tipo, si es un tipo) y el tipo si corresponde. Una categoría que no está
 * en la lista (archivada y filtrada, o borrada) da `{ area: null, type: null }`.
 */
export function resolveCategory(categoryId: string | null | undefined, categories: CategoryRow[]): ResolvedCategory {
  if (!categoryId) return { area: null, type: null };
  const byId = new Map(categories.map((c) => [c.id, c]));
  const found = byId.get(categoryId);
  if (!found) return { area: null, type: null };
  if (found.parent_id === null) return { area: found, type: null };
  return { area: byId.get(found.parent_id) ?? null, type: found };
}

export interface CategorySnapshot {
  area_id: string | null;
  area_name: string | null;
  type_id: string | null;
  type_name: string | null;
}

/** Lo que la agenda copia al crearse (F51). */
export function categorySnapshot(categoryId: string | null | undefined, categories: CategoryRow[]): CategorySnapshot {
  const { area, type } = resolveCategory(categoryId, categories);
  return {
    area_id: area?.id ?? null,
    area_name: area?.name ?? null,
    type_id: type?.id ?? null,
    type_name: type?.name ?? null,
  };
}

/** "Ventas · Triaje" o "Ventas". Vacío si no hay categoría. */
export function categoryLabel(categoryId: string | null | undefined, categories: CategoryRow[]): string {
  const { area, type } = resolveCategory(categoryId, categories);
  if (!area) return "";
  return type ? `${area.name} · ${type.name}` : area.name;
}

/** Si `categoryId` (área o tipo) cae dentro del área `areaId` (F51: filtrar por área incluye sus tipos). */
export function isInArea(categoryId: string | null | undefined, areaId: string, categories: CategoryRow[]): boolean {
  const { area } = resolveCategory(categoryId, categories);
  return area?.id === areaId;
}

/** Los ids que cubre un filtro por categoría: un área cubre sus tipos. */
export function expandCategoryFilter(filterIds: string[], categories: CategoryRow[]): Set<string> {
  const out = new Set<string>();
  for (const id of filterIds) {
    out.add(id);
    for (const c of categories) if (c.parent_id === id) out.add(c.id);
  }
  return out;
}

export type CategoryNameError = "empty" | "too_long" | "duplicate";

/**
 * Nombre de un área o tipo: hasta 40 caracteres, único entre los activos del
 * mismo nivel (sin distinguir mayúsculas).
 */
export function validateCategoryName(
  raw: string,
  siblings: Array<Pick<CategoryRow, "id" | "name" | "archived_at">>,
  exceptId?: string | null,
): { ok: true; name: string } | { ok: false; error: CategoryNameError; message: string } {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "empty", message: "Escribí un nombre" };
  if (name.length > CATEGORY_NAME_MAX) return { ok: false, error: "too_long", message: `Hasta ${CATEGORY_NAME_MAX} caracteres` };
  const clash = siblings.some((s) => s.id !== exceptId && !s.archived_at && s.name.toLowerCase() === name.toLowerCase());
  if (clash) return { ok: false, error: "duplicate", message: "Ya existe una con ese nombre" };
  return { ok: true, name };
}

/** Puede archivarse: nunca un área de sistema (se renombra, no se borra). */
export function canArchive(category: Pick<CategoryRow, "is_system" | "parent_id">): { ok: boolean; reason?: string } {
  if (category.is_system && category.parent_id === null) {
    return { ok: false, reason: "Ventas y Servicio vienen creadas: se renombran pero no se archivan" };
  }
  return { ok: true };
}

/** Las áreas activas en orden, cada una con sus tipos activos en orden. */
export function categoryTree(categories: CategoryRow[], includeArchived = false): Array<{ area: CategoryRow; types: CategoryRow[] }> {
  const keep = (c: CategoryRow) => includeArchived || !c.archived_at;
  const areas = categories.filter((c) => c.parent_id === null && keep(c)).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  return areas.map((area) => ({
    area,
    types: categories.filter((c) => c.parent_id === area.id && keep(c)).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
  }));
}

/** Nuevo orden después de mover `id` a la posición `toIndex` entre sus hermanos. */
export function reorderSiblings(siblings: CategoryRow[], id: string, toIndex: number): Array<{ id: string; position: number }> {
  const sorted = [...siblings].sort((a, b) => a.position - b.position);
  const from = sorted.findIndex((c) => c.id === id);
  if (from < 0) return sorted.map((c, i) => ({ id: c.id, position: i }));
  const [moved] = sorted.splice(from, 1);
  sorted.splice(Math.max(0, Math.min(toIndex, sorted.length)), 0, moved);
  return sorted.map((c, i) => ({ id: c.id, position: i }));
}
