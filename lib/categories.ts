/**
 * Categorias tipo etiqueta (automatizaciones desde oct 2026, formularios desde nov 2026). Puro: lo usan las pantallas
 * y las Server Actions.
 *
 * Son palabras o frases libres: una pieza puede tener varias, se escriben a mano o se eligen de las que ya usan las
 * demas. No hay catalogo aparte: viven en una columna `categories text[]` de cada tabla (`flows` 00254, `forms` 00406),
 * y cada lista tiene las suyas (las de formularios no se mezclan con las de automatizaciones).
 */

export const MAX_CATEGORIES = 10;
/** El nombre viejo (automatizaciones): mismo tope. */
export const MAX_CATEGORIES_PER_FLOW = MAX_CATEGORIES;
export const MAX_CATEGORY_LENGTH = 40;

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
 * el tope por pieza.
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
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

/**
 * Las categorias que ya existen en el negocio, de la mas usada a la menos usada (empate: alfabetico). Si dos piezas
 * escribieron la misma con distinta forma ("ventas" y "Ventas"), queda la forma mas usada.
 */
export function categorySuggestions(items: Array<{ categories?: string[] | null }>): Array<{ name: string; count: number }> {
  const byKey = new Map<string, { forms: Map<string, number>; count: number }>();
  for (const item of items) {
    for (const raw of normalizeCategories(item.categories ?? [])) {
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

/**
 * Renombrar una categoria en una lista: reemplaza la que coincide (sin tildes ni mayusculas) por `to`. Si `to` ya
 * estaba, quedan unidas (sin repetirse). Si no la tenia, la lista vuelve igual.
 */
export function renameCategoryIn(list: string[], from: string, to: string): string[] {
  const fromKey = categoryKey(from);
  const clean = normalizeCategory(to);
  if (!clean || !list.some((c) => categoryKey(c) === fromKey)) return normalizeCategories(list);
  return normalizeCategories(list.map((c) => (categoryKey(c) === fromKey ? clean : c)));
}

/** Sacar una categoria de una lista (sin tildes ni mayusculas). */
export function removeCategoryFrom(list: string[], name: string): string[] {
  const key = categoryKey(name);
  return normalizeCategories(list.filter((c) => categoryKey(c) !== key));
}

/** Si dos listas dicen lo mismo (mismo orden y misma forma escrita). */
export function sameCategories(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}
