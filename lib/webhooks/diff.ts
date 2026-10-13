/**
 * Que cambio un envio en un contacto: `{ campo: { before, after } }`.
 * Solo los campos que cambiaron; sin cambios da `{}`. "Vacio" (null, undefined,
 * texto vacio) es una sola cosa: pasar de null a "" no es un cambio.
 */
export type FieldDiff = Record<string, { before: unknown; after: unknown }>;

const norm = (value: unknown): unknown => (value === undefined || value === "" ? null : value);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

export function diffFields(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined): FieldDiff {
  const b = before ?? {};
  const a = after ?? {};
  const out: FieldDiff = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (!same(b[key], a[key])) out[key] = { before: norm(b[key]), after: norm(a[key]) };
  }
  return out;
}
