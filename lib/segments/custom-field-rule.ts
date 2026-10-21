/**
 * La regla "campo personalizado" de un segmento.
 *
 * El editor (components/segment-builder.tsx) guarda `slug::valor`. La ruta de
 * envío la cortaba en el PRIMER ":", así que el valor quedaba ":valor" y la
 * regla no encontraba a nadie nunca. Se lee acá, en un solo lugar; una regla
 * vieja escrita a mano como `slug:valor` se sigue entendiendo.
 *
 * Puro: lo usan la ruta de envío y su test.
 */

import { normalizeCustomValue } from "@/lib/custom-fields";

export function parseCustomFieldRule(raw: string): { slug: string; value: string } {
  const text = raw ?? "";
  const double = text.indexOf("::");
  if (double >= 0) return { slug: text.slice(0, double).trim(), value: text.slice(double + 2) };
  const single = text.indexOf(":");
  if (single >= 0) return { slug: text.slice(0, single).trim(), value: text.slice(single + 1) };
  return { slug: text.trim(), value: "" };
}

/** Contra qué columna se compara y con qué valor, según el tipo del campo. */
export type CustomFieldComparison =
  | { column: "value_number"; value: number }
  | { column: "value_date"; value: string }
  | { column: "value"; value: string };

/**
 * Un número se compara como número (antes "10" < "9" porque se comparaba el
 * texto) y una fecha como fecha. Si el valor de la regla no corresponde al
 * tipo, null: la regla no encuentra a nadie, en vez de comparar cualquier cosa.
 */
export function comparisonFor(type: string, ruleValue: string): CustomFieldComparison | null {
  const text = ruleValue.trim();
  if (type === "number") {
    const n = normalizeCustomValue("number", text);
    return n.ok ? { column: "value_number", value: Number(n.value) } : null;
  }
  if (type === "date") {
    const d = normalizeCustomValue("date", text);
    return d.ok ? { column: "value_date", value: d.value } : null;
  }
  if (type === "boolean" || type === "email") {
    const v = normalizeCustomValue(type, text);
    return v.ok ? { column: "value", value: v.value } : null;
  }
  return { column: "value", value: text };
}
