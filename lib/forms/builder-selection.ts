/**
 * Que esta elegido en el constructor (plano formularios-ui, F9-F11): el formulario entero, una pregunta, la
 * pantalla final o, en un contrato, el bloque del texto o el de la aceptacion y la firma. La seleccion guarda el `id` de la pregunta (no su posicion), asi sobrevive a mover, duplicar o
 * agregar otras. Puro.
 */
import type { FormField } from "./fields";

export type BuilderSelection =
  | { kind: "form" }
  | { kind: "field"; id: string }
  | { kind: "end" }
  | { kind: "contract_text" }
  | { kind: "contract_signing" };

export const FORM_SELECTION: BuilderSelection = { kind: "form" };

/** Una seleccion que apunta a una pregunta que ya no existe vuelve al formulario. El mismo objeto si sigue valida. */
export function normalizeSelection(selection: BuilderSelection, fields: FormField[]): BuilderSelection {
  if (selection.kind === "field" && !fields.some((f) => f.id === selection.id)) return FORM_SELECTION;
  return selection;
}

/** El indice de la pregunta elegida, o -1. */
export function selectedIndex(selection: BuilderSelection, fields: FormField[]): number {
  return selection.kind === "field" ? fields.findIndex((f) => f.id === selection.id) : -1;
}

/** Tras borrar la pregunta de `index`: la que queda en su lugar (o la de arriba); si no queda ninguna, el formulario. */
export function selectionAfterRemove(fieldsAfter: FormField[], index: number): BuilderSelection {
  const next = fieldsAfter[Math.min(index, fieldsAfter.length - 1)];
  return next ? { kind: "field", id: next.id } : FORM_SELECTION;
}

/** En un reporte de fin de dia no hay panel del formulario: lo elegido por defecto es la primera pregunta (o nada). */
export function defaultEodSelection(fields: FormField[]): BuilderSelection {
  return fields[0] ? { kind: "field", id: fields[0].id } : FORM_SELECTION;
}
