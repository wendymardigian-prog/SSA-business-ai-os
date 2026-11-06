/**
 * Como se decide el area y el tipo de una grabacion. Puro.
 *
 * Decide el primer paso que da un area, en este orden: la reunion vinculada, una
 * regla, el area por defecto de la conexion y la IA. Lo que eligio una persona no
 * pasa por aca: se respeta antes de llamar a esta funcion.
 *
 * Si el paso que decidio solo da el area, los siguientes pueden completar el tipo
 * DENTRO de esa area, sin cambiarla. Una reunion de Servicio nunca termina en Ventas
 * porque una regla o la IA opinen otra cosa.
 */

import type { CategoryRow, CategorySnapshot } from "@/lib/scheduling/categories";

export type CascadeSource = "booking" | "rule" | "connection" | "ai";

export interface CascadeInput {
  booking?: CategorySnapshot | null;
  rule?: CategorySnapshot | null;
  connection?: CategorySnapshot | null;
  ai?: CategorySnapshot | null;
}

export interface CascadeResult {
  snapshot: CategorySnapshot | null;
  /** Quien decidio el area. */
  source: CascadeSource | null;
}

const ORDER: CascadeSource[] = ["booking", "rule", "connection", "ai"];

export function resolveCascade(input: CascadeInput): CascadeResult {
  let result: CascadeResult = { snapshot: null, source: null };
  for (const step of ORDER) {
    const candidate = input[step];
    if (!candidate?.area_id) continue;
    const current = result.snapshot;
    if (!current) {
      result = { snapshot: { ...candidate }, source: step };
    } else if (!current.type_id && candidate.type_id && candidate.area_id === current.area_id) {
      result = { snapshot: { ...current, type_id: candidate.type_id, type_name: candidate.type_name }, source: result.source };
    }
    if (result.snapshot?.type_id) break;
  }
  return result;
}

/**
 * Hace falta preguntarle a la IA: nadie dio el area, o la dieron y el area tiene tipos para
 * elegir. Un area sin tipos ya esta completa: consultar seria gastar por nada.
 */
export function needsAi(result: CascadeResult, categories: CategoryRow[]): boolean {
  const snapshot = result.snapshot;
  if (!snapshot?.area_id) return true;
  if (snapshot.type_id) return false;
  return categories.some((c) => c.parent_id === snapshot.area_id && !c.archived_at);
}

/** El tipo o, si solo se sabe el area, el area: lo que va en `calls.category_id`. */
export function categoryIdOf(snapshot: CategorySnapshot | null): string | null {
  return snapshot?.type_id ?? snapshot?.area_id ?? null;
}
