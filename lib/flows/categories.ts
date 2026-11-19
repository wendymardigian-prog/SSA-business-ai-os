/**
 * Las categorias de una automatizacion (auditoria de automatizaciones, oct 2026): viven en `flows.categories` (00254).
 * Lo comun con las de formularios esta en `lib/categories.ts`; aca quedan los topes propios de una automatizacion.
 */

export {
  categoryKey,
  categorySuggestions,
  MAX_CATEGORIES_PER_FLOW,
  MAX_CATEGORY_LENGTH,
  normalizeCategories,
  normalizeCategory,
} from "@/lib/categories";

export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_FLOW_NAME_LENGTH = 120;

/** La descripcion: recortada, con el tope; vacia => null. */
export function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().slice(0, MAX_DESCRIPTION_LENGTH).trim();
  return clean ? clean : null;
}

/** El nombre de una automatizacion recien creada. */
export const NEW_FLOW_NAME = "Automatización sin nombre";

/** El disparador con el que nace una automatizacion: en el lienzo, sin elegir (`triggerType: null`). */
export function newTriggerNode(): { id: string; type: "trigger"; position: { x: number; y: number }; data: { triggerType: null } } {
  return { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { triggerType: null } };
}
