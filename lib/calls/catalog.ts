/**
 * Las grabaciones sobre la lista de areas y tipos de la agenda. Puro.
 *
 * La clave vieja de tipo ya no se guarda (00308): se deriva con `legacyCallTypeFor`. De ella
 * dependen el resumen, Conocimiento, la rubrica de un analisis viejo y los filtros viejos de los
 * flujos. Sale de la `system_key` de cada fila, nunca del nombre, porque las areas y los tipos se
 * renombran.
 */

import { categorySnapshot, type CategoryRow, type CategorySnapshot } from "@/lib/scheduling/categories";

/** La regla que marca una llamada como "no se presento": no decide area ni tipo. */
export const NO_SHOW_TARGET = "no_show";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un tipo viejo, en la lista nueva. Lo necesitan las reglas guardadas con la clave vieja. */
const LEGACY_TO_SYSTEM_KEY: Record<string, string> = {
  cierre: "ventas.cierre",
  venta: "ventas.cierre",
  seguimiento: "ventas.seguimiento",
  triaje: "ventas.triaje",
  equipo: "equipo",
  cliente: "servicio",
  clase: "servicio",
  otra: "otros",
};

const SYSTEM_KEY_TO_LEGACY: Record<string, string> = {
  "ventas.cierre": "cierre",
  "ventas.seguimiento": "seguimiento",
  "ventas.triaje": "triaje",
};

const AREA_KEY_TO_LEGACY: Record<string, string> = {
  ventas: "cierre",
  servicio: "cliente",
  equipo: "equipo",
};

export const isCategoryId = (value: string): boolean => UUID.test(value);

const active = (categories: CategoryRow[]) => categories.filter((c) => !c.archived_at);

/**
 * A que area y tipo apunta una regla: un id de la lista o, en una regla vieja, una clave de
 * tipo. Una que ya no existe (archivada, o un tipo propio que no se pudo convertir) no decide.
 */
export function ruleTargetSnapshot(
  target: string,
  categories: CategoryRow[],
  customTypes: Array<{ clave: string; nombre: string }> = [],
): CategorySnapshot | null {
  const list = active(categories);
  let id: string | undefined;
  if (isCategoryId(target)) {
    id = list.find((c) => c.id === target)?.id;
  } else if (LEGACY_TO_SYSTEM_KEY[target]) {
    id = list.find((c) => c.system_key === LEGACY_TO_SYSTEM_KEY[target])?.id;
  } else {
    const custom = customTypes.find((t) => t.clave === target);
    const otros = list.find((c) => c.system_key === "otros");
    if (custom && otros) {
      const name = custom.nombre.trim().toLowerCase();
      id = list.find((c) => c.parent_id === otros.id && c.name.toLowerCase() === name)?.id;
    }
  }
  if (!id) return null;
  const snapshot = categorySnapshot(id, categories);
  return snapshot.area_id ? snapshot : null;
}

/**
 * La clave vieja de tipo de una grabacion. Un tipo que creo el negocio toma el comportamiento de
 * su area: un tipo nuevo de Ventas se trata como un cierre.
 */
export function legacyCallTypeFor(snapshot: CategorySnapshot | null, categories: Array<Pick<CategoryRow, "id" | "system_key">>, noShow = false): string | null {
  if (noShow) return "no_show";
  if (!snapshot?.area_id) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const typeKey = snapshot.type_id ? byId.get(snapshot.type_id)?.system_key : null;
  if (typeKey && SYSTEM_KEY_TO_LEGACY[typeKey]) return SYSTEM_KEY_TO_LEGACY[typeKey];
  const areaKey = byId.get(snapshot.area_id)?.system_key;
  return (areaKey && AREA_KEY_TO_LEGACY[areaKey]) || "otra";
}

/** A que id apunta una regla guardada con una clave vieja: la pantalla muestra la lista nueva. */
export function legacyRuleTargets(
  categories: CategoryRow[],
  customTypes: Array<{ clave: string; nombre: string }> = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [...Object.keys(LEGACY_TO_SYSTEM_KEY), ...customTypes.map((t) => t.clave)]) {
    const snapshot = ruleTargetSnapshot(key, categories, customTypes);
    const id = snapshot?.type_id ?? snapshot?.area_id;
    if (id) out[key] = id;
  }
  return out;
}

/** Lee el snapshot guardado. Lo que no tiene la forma esperada es "sin clasificar". */
export function readCategorySnapshot(raw: unknown): CategorySnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Partial<CategorySnapshot>;
  if (typeof s.area_id !== "string" || !s.area_id) return null;
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { area_id: s.area_id, area_name: text(s.area_name), type_id: text(s.type_id), type_name: text(s.type_name) };
}

/** "Ventas · Cierre", "Servicio" o "Sin clasificar". */
export function callCategoryLabel(snapshot: CategorySnapshot | null): string {
  if (!snapshot?.area_id) return "Sin clasificar";
  return snapshot.type_name ? `${snapshot.area_name} · ${snapshot.type_name}` : snapshot.area_name ?? "Sin clasificar";
}

/** Lo que se muestra de una grabacion: su area y tipo, con la marca de no show si la tiene. */
export function callDisplayLabel(raw: unknown, noShow = false): string {
  const snapshot = readCategorySnapshot(raw);
  if (snapshot) return noShow ? `${callCategoryLabel(snapshot)} · No show` : callCategoryLabel(snapshot);
  return noShow ? "No show" : "Sin clasificar";
}

export interface CategoryGroup {
  areaId: string;
  areaName: string;
  types: Array<{ id: string; name: string }>;
}

/** Las areas activas con sus tipos activos, en orden: lo que ofrecen los selectores. */
export function categoryGroups(categories: CategoryRow[]): CategoryGroup[] {
  const list = active(categories);
  return list
    .filter((c) => c.parent_id === null)
    .sort((a, b) => a.position - b.position)
    .map((area) => ({
      areaId: area.id,
      areaName: area.name,
      types: list
        .filter((c) => c.parent_id === area.id)
        .sort((a, b) => a.position - b.position)
        .map((t) => ({ id: t.id, name: t.name })),
    }));
}

export interface ClassifierOption {
  label: string;
  categoryId: string;
  description: string | null;
}

/**
 * Lo que puede elegir la IA: cada tipo activo y las areas que no tienen tipos. Con un area ya
 * decidida, solo los tipos de esa area: la IA completa, no contradice.
 */
export function classifierOptions(categories: CategoryRow[], onlyAreaId?: string | null): ClassifierOption[] {
  const list = active(categories);
  const out: ClassifierOption[] = [];
  for (const group of categoryGroups(categories)) {
    if (onlyAreaId && group.areaId !== onlyAreaId) continue;
    if (group.types.length === 0) {
      out.push({ label: group.areaName, categoryId: group.areaId, description: list.find((c) => c.id === group.areaId)?.description ?? null });
      continue;
    }
    for (const type of group.types) {
      out.push({ label: `${group.areaName} · ${type.name}`, categoryId: type.id, description: list.find((c) => c.id === type.id)?.description ?? null });
    }
  }
  return out;
}
