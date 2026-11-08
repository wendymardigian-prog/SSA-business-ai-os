/**
 * El alcance de un pedido a la IA (F34).
 *
 * «Sobre: Todo / Solo la página N». Con una página, el parche solo puede tocar
 * ESA página: uno que toca otra, o que agrega o quita páginas, se descarta (y
 * la corrida lo reintenta una vez con el motivo). La revisión automática usa el
 * mismo mecanismo con las páginas que tienen problemas.
 *
 * Módulo puro.
 */

import type { DesignDoc } from "../doc/schema";
import { applyPatch, type ApplyResult } from "./patch";
import type { DesignPatch } from "./schema";

/** `page: null` = todo el diseño; un número = solo esa página (0 = la primera). `pages` = un conjunto (la revisión automática). */
export type PatchScope = { page: number | null } | { pages: readonly number[] };

/** Las páginas permitidas del alcance; `null` si es todo. */
export function allowedPages(scope: PatchScope): readonly number[] | null {
  if ("pages" in scope) return scope.pages;
  return scope.page === null ? null : [scope.page];
}

/** Lo que el parche toca fuera del alcance, en palabras. Vacío = todo adentro. */
export function scopeViolations(patch: DesignPatch, scope: PatchScope): string[] {
  const allowed = allowedPages(scope);
  if (allowed === null) return [];
  const problems: string[] = [];
  const set = new Set(allowed);
  const where = allowed.length === 1 ? `Solo se puede tocar la página ${allowed[0] + 1}` : `Solo se pueden tocar las páginas ${allowed.map((p) => p + 1).join(", ")}`;
  for (const entry of patch.pages) {
    if (!set.has(entry.index)) problems.push(`${where}: el cambio toca la página ${entry.index + 1}, fuera del alcance`);
  }
  if ((patch.newPages?.length ?? 0) > 0) problems.push(`${where}: no se pueden agregar páginas`);
  if ((patch.removePages?.length ?? 0) > 0) problems.push(`${where}: no se pueden quitar páginas`);
  return [...new Set(problems)];
}

/** Aplica el parche solo si respeta el alcance. */
export function applyScoped(doc: DesignDoc, patch: DesignPatch, scope: PatchScope): ApplyResult {
  const violations = scopeViolations(patch, scope);
  if (violations.length) return { ok: false, problems: violations };
  return applyPatch(doc, patch);
}
