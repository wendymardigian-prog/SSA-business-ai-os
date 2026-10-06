/**
 * Pilares y ofertas: las reglas puras (F89).
 *
 * Son listas del negocio que se configuran en Ajustes y se eligen al cargar
 * una idea o una pieza. Tres reglas que el resto del modulo da por hechas:
 *
 *  1. Se ARCHIVAN, nunca se borran. Una pieza ya publicada tiene que seguir
 *     mostrando su pilar aunque ya no se ofrezca en el selector, y el
 *     dashboard tiene que poder filtrar por el.
 *  2. El nombre es unico entre los NO archivados, sin mirar mayusculas ni
 *     espacios de mas. Un archivado libera el nombre.
 *  3. Lo que no tiene pilar (u oferta) no queda fuera de los conteos: se
 *     agrupa como "Sin pilar".
 *
 * Nada de esto toca la base ni React: la accion y la pantalla solo lo llaman.
 */

export const TAXONOMY_NAME_MAX = 60;

export const NO_PILLAR_LABEL = "Sin pilar";
export const NO_OFFER_LABEL = "Sin oferta";

/** Colores de pilar que se ofrecen. Es lo unico que acepta `isValidColor`. */
export const PILLAR_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
] as const;

export interface TaxonomyItem {
  id: string;
  name: string;
  archivedAt: string | null;
}

/** Recorta y junta los espacios de adentro: "  A   B " -> "A B". */
export function normalizeName(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

function foldName(raw: string): string {
  return normalizeName(raw).toLowerCase();
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * Valida un nombre nuevo o un renombrado.
 *
 * `selfId` es la fila que se esta renombrando: no choca consigo misma, asi
 * "educativo" -> "Educativo" (corregir una mayuscula) se puede.
 */
export function checkName(
  raw: string,
  existing: Array<Pick<TaxonomyItem, "id" | "name" | "archivedAt">>,
  selfId?: string,
): NameCheck {
  const name = normalizeName(raw);
  if (!name) return { ok: false, error: "Falta el nombre" };
  if (name.length > TAXONOMY_NAME_MAX) {
    return { ok: false, error: `El nombre es muy largo: maximo ${TAXONOMY_NAME_MAX} caracteres` };
  }

  const clash = existing.find(
    (other) => other.archivedAt === null && other.id !== selfId && foldName(other.name) === foldName(name),
  );
  if (clash) return { ok: false, error: `Ya existe "${clash.name}"` };

  return { ok: true, name };
}

export function isValidColor(color: string | null | undefined): boolean {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
}

/** El primer color de la paleta que no esta en uso; si se usaron todos, vuelve a empezar. */
export function nextColor(used: Array<string | null | undefined>): string {
  const taken = new Set(used.filter((c): c is string => Boolean(c)).map((c) => c.toLowerCase()));
  return PILLAR_COLORS.find((c) => !taken.has(c)) ?? PILLAR_COLORS[taken.size % PILLAR_COLORS.length];
}

/**
 * Lo que ofrece un selector: los no archivados por nombre, mas el que la
 * pieza ya tiene aunque este archivado (si no, abrir una pieza vieja
 * mostraria el selector vacio y guardarla le borraria el pilar sin avisar).
 */
export function selectableItems<T extends TaxonomyItem>(items: T[], currentId: string | null | undefined): T[] {
  return items
    .filter((i) => i.archivedAt === null || i.id === currentId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** El nombre a mostrar para un id, con "Sin ..." cuando no hay o ya no existe. */
export function labelFor(
  items: TaxonomyItem[],
  id: string | null | undefined,
  noneLabel: string,
): { label: string; archived: boolean } {
  const found = id ? items.find((i) => i.id === id) : undefined;
  if (!found) return { label: noneLabel, archived: false };
  return { label: found.name, archived: found.archivedAt !== null };
}

/** Cuantas filas usan cada id. Los null (sin asignar) no cuentan: no tienen fila de la cual colgar. */
export function countUsage(ids: Array<string | null | undefined>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export interface TaxonomyGroup<T> {
  id: string | null;
  label: string;
  archived: boolean;
  rows: T[];
}

/**
 * Agrupa filas por pilar u oferta, sin perder ninguna.
 *
 * La suma de los grupos es siempre el total: lo que no tiene id, y lo que
 * apunta a un id que ya no esta en la lista, cae en el grupo "Sin ..." (que
 * va ultimo y solo aparece si tiene filas).
 */
export function groupByTaxonomy<T>(
  rows: T[],
  getId: (row: T) => string | null | undefined,
  items: TaxonomyItem[],
  noneLabel: string,
  options: { includeEmpty?: boolean } = {},
): Array<TaxonomyGroup<T>> {
  const known = new Map(items.map((i) => [i.id, i]));
  const byId = new Map<string, T[]>();
  const none: T[] = [];

  for (const row of rows) {
    const id = getId(row);
    if (id && known.has(id)) {
      const bucket = byId.get(id);
      if (bucket) bucket.push(row);
      else byId.set(id, [row]);
    } else {
      none.push(row);
    }
  }

  const groups: Array<TaxonomyGroup<T>> = [...items]
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .filter((i) => options.includeEmpty || byId.has(i.id))
    .map((i) => ({
      id: i.id,
      label: i.name,
      archived: i.archivedAt !== null,
      rows: byId.get(i.id) ?? [],
    }));

  if (none.length > 0 || options.includeEmpty) {
    groups.push({ id: null, label: noneLabel, archived: false, rows: none });
  }

  return groups;
}
