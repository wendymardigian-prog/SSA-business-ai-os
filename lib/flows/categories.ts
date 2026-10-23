/**
 * Las categorias de una automatizacion (auditoria de automatizaciones, oct 2026). Puro: lo usan la pantalla y las
 * Server Actions.
 *
 * Son palabras o frases libres, como las etiquetas: una automatizacion puede tener varias, se escriben a mano o se
 * eligen de las que ya usan las demas. No hay catalogo aparte (viven en `flows.categories`, 00254).
 */

export const MAX_CATEGORIES_PER_FLOW = 10;
export const MAX_CATEGORY_LENGTH = 40;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_FLOW_NAME_LENGTH = 120;

/** La forma de comparar: sin tildes ni mayusculas ("Ventas" = "ventas" = "véntas"). */
export function categoryKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Una categoria escrita: sin espacios de mas y con el tope de largo. Vacia => null. */
export function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim().slice(0, MAX_CATEGORY_LENGTH).trim();
  return clean ? clean : null;
}

/**
 * La lista final: normalizada, sin repetidas (no distingue mayusculas ni tildes, gana la primera forma escrita) y con
 * el tope por flujo.
 */
export function normalizeCategories(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = normalizeCategory(value);
    if (!clean) continue;
    const key = categoryKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= MAX_CATEGORIES_PER_FLOW) break;
  }
  return out;
}

/**
 * Las categorias que ya existen en el negocio, de la mas usada a la menos usada (empate: alfabetico). Si dos flujos
 * escribieron la misma con distinta forma ("ventas" y "Ventas"), queda la forma mas usada.
 */
export function categorySuggestions(flows: Array<{ categories?: string[] | null }>): Array<{ name: string; count: number }> {
  const byKey = new Map<string, { forms: Map<string, number>; count: number }>();
  for (const flow of flows) {
    for (const raw of normalizeCategories(flow.categories ?? [])) {
      const key = categoryKey(raw);
      const entry = byKey.get(key) ?? { forms: new Map(), count: 0 };
      entry.count += 1;
      entry.forms.set(raw, (entry.forms.get(raw) ?? 0) + 1);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .map((entry) => ({ name: [...entry.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))[0][0], count: entry.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"));
}

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
