/**
 * Lo que cada persona elige de una tabla: qué columnas ve, en qué orden, cuáles quedan fijas y qué ancho tiene cada una.
 * PURO: sin DOM ni storage; lo componen `use-table-prefs.ts` y las pantallas.
 *
 * Todo se guarda como DIFERENCIA con lo normal (el catálogo de columnas de la pantalla): una columna nueva aparece sola, con
 * su visibilidad y su ancho de siempre, sin que nadie tenga que prenderla. Lo que no se puede leer, o que ya no existe en el
 * catálogo, se ignora: una preferencia vieja nunca rompe la tabla.
 */

/** Lo que una pantalla declara de cada columna (el dibujo de la celda vive aparte, en el componente). */
export interface ColumnMeta {
  key: string;
  label: string;
  /** El grupo del menú «Columnas» (opcional). */
  group?: string;
  /** Se ve de entrada. Por defecto sí. */
  defaultVisible?: boolean;
  /** Ancho normal en px. Por defecto `DEFAULT_COLUMN_WIDTH`. */
  defaultWidth?: number;
  /** Se puede ocultar. Por defecto sí. */
  hideable?: boolean;
  /** Se puede fijar a la izquierda. Por defecto sí. */
  pinnable?: boolean;
  /** Se puede cambiar el ancho. Por defecto sí. */
  resizable?: boolean;
}

export interface TablePrefs {
  /** El orden completo elegido. Vacío = el del catálogo. */
  order: string[];
  /** Columnas que se ven por defecto y la persona ocultó. */
  hidden: string[];
  /** Columnas que están ocultas por defecto y la persona prendió. */
  shown: string[];
  /** Fijas a la izquierda, en el orden en que se fijaron. */
  pinned: string[];
  /** Solo los anchos que difieren del normal. */
  widths: Record<string, number>;
}

export const DEFAULT_COLUMN_WIDTH = 160;
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 640;

export const emptyPrefs = (): TablePrefs => ({ order: [], hidden: [], shown: [], pinned: [], widths: {} });

export function clampWidth(px: number): number {
  if (!Number.isFinite(px)) return MIN_COLUMN_WIDTH;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(px)));
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 80))] : []);

/** Lo guardado, sin confiar en él. Cualquier cosa rara es «nada guardado». */
export function parsePrefs(raw: unknown): TablePrefs {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return emptyPrefs();
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyPrefs();
  const o = value as Record<string, unknown>;
  const widths: Record<string, number> = {};
  if (o.widths && typeof o.widths === "object" && !Array.isArray(o.widths)) {
    for (const [key, width] of Object.entries(o.widths as Record<string, unknown>)) {
      if (typeof width === "number" && Number.isFinite(width) && key.length <= 80) widths[key] = clampWidth(width);
    }
  }
  return { order: strings(o.order), hidden: strings(o.hidden), shown: strings(o.shown), pinned: strings(o.pinned), widths };
}

/** Saca de las preferencias lo que ya no existe en el catálogo y lo que contradice a una columna (una no ocultable, un ancho igual al normal). */
export function normalizePrefs(metas: readonly ColumnMeta[], prefs: TablePrefs): TablePrefs {
  const byKey = new Map(metas.map((m) => [m.key, m]));
  const known = (key: string) => byKey.has(key);
  const widths: Record<string, number> = {};
  for (const [key, width] of Object.entries(prefs.widths)) {
    const meta = byKey.get(key);
    if (meta && meta.resizable !== false && clampWidth(width) !== defaultWidth(meta)) widths[key] = clampWidth(width);
  }
  const hidden = prefs.hidden.filter((k) => known(k) && byKey.get(k)!.hideable !== false && byKey.get(k)!.defaultVisible !== false);
  const shown = prefs.shown.filter((k) => known(k) && byKey.get(k)!.defaultVisible === false && !hidden.includes(k));
  const order = prefs.order.filter(known);
  const catalog = metas.map((m) => m.key);
  const sameAsCatalog = order.length === catalog.length && order.every((k, i) => k === catalog[i]);
  return {
    order: order.length === 0 || sameAsCatalog ? [] : order,
    hidden,
    shown,
    pinned: prefs.pinned.filter((k) => known(k) && byKey.get(k)!.pinnable !== false),
    widths,
  };
}

export const defaultWidth = (meta: ColumnMeta): number => meta.defaultWidth ?? DEFAULT_COLUMN_WIDTH;

export function columnWidth(meta: ColumnMeta, prefs: TablePrefs): number {
  const saved = prefs.widths[meta.key];
  return typeof saved === "number" && meta.resizable !== false ? clampWidth(saved) : defaultWidth(meta);
}

/** Todas las columnas (vistas u ocultas) en el orden del menú: el elegido y, al final, las que no estaban en él. */
export function orderedKeys(metas: readonly ColumnMeta[], prefs: TablePrefs): string[] {
  const catalog = metas.map((m) => m.key);
  const known = new Set(catalog);
  const chosen = prefs.order.filter((k) => known.has(k));
  const rest = catalog.filter((k) => !chosen.includes(k));
  return [...chosen, ...rest];
}

export function isColumnVisible(meta: ColumnMeta, prefs: TablePrefs): boolean {
  if (meta.hideable === false) return true;
  if (prefs.shown.includes(meta.key)) return true;
  if (prefs.hidden.includes(meta.key)) return false;
  return meta.defaultVisible !== false;
}

/** Las columnas que se dibujan, en orden. Las fijas se acomodan aparte (`splitPinned`). */
export function visibleColumns<T extends ColumnMeta>(metas: readonly T[], prefs: TablePrefs): T[] {
  const byKey = new Map(metas.map((m) => [m.key, m]));
  return orderedKeys(metas, prefs)
    .map((k) => byKey.get(k)!)
    .filter((m) => isColumnVisible(m, prefs));
}

export function toggleColumn(metas: readonly ColumnMeta[], prefs: TablePrefs, key: string): TablePrefs {
  const meta = metas.find((m) => m.key === key);
  if (!meta || meta.hideable === false) return prefs;
  const target = !isColumnVisible(meta, prefs);
  const without = (list: string[]) => list.filter((k) => k !== key);
  const next = { ...prefs, hidden: without(prefs.hidden), shown: without(prefs.shown) };
  if (target !== (meta.defaultVisible !== false)) {
    if (target) next.shown = [...next.shown, key];
    else next.hidden = [...next.hidden, key];
  }
  return normalizePrefs(metas, next);
}

/** Muestra todas las columnas. */
export function showAllColumns(metas: readonly ColumnMeta[], prefs: TablePrefs): TablePrefs {
  return normalizePrefs(metas, { ...prefs, hidden: [], shown: metas.filter((m) => m.defaultVisible === false).map((m) => m.key) });
}

/** Sube o baja una columna un lugar dentro del orden del menú. */
export function moveColumn(metas: readonly ColumnMeta[], prefs: TablePrefs, key: string, delta: -1 | 1): TablePrefs {
  const keys = orderedKeys(metas, prefs);
  const from = keys.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= keys.length) return prefs;
  [keys[from], keys[to]] = [keys[to], keys[from]];
  return normalizePrefs(metas, { ...prefs, order: keys });
}

/** Mueve una columna al lugar de otra (el arrastre del menú). */
export function moveColumnTo(metas: readonly ColumnMeta[], prefs: TablePrefs, key: string, targetKey: string): TablePrefs {
  if (key === targetKey) return prefs;
  const keys = orderedKeys(metas, prefs);
  const from = keys.indexOf(key);
  const target = keys.indexOf(targetKey);
  if (from < 0 || target < 0) return prefs;
  keys.splice(from, 1);
  keys.splice(target, 0, key);
  return normalizePrefs(metas, { ...prefs, order: keys });
}

/** Fijar o soltar una columna. Fijar la agrega al final de las fijas. */
export function togglePinned(metas: readonly ColumnMeta[], prefs: TablePrefs, key: string): TablePrefs {
  const meta = metas.find((m) => m.key === key);
  if (!meta || meta.pinnable === false) return prefs;
  const pinned = prefs.pinned.includes(key) ? prefs.pinned.filter((k) => k !== key) : [...prefs.pinned, key];
  return { ...prefs, pinned };
}

/** Un ancho nuevo; si queda igual al normal no deja rastro. */
export function setColumnWidth(metas: readonly ColumnMeta[], prefs: TablePrefs, key: string, px: number): TablePrefs {
  const meta = metas.find((m) => m.key === key);
  if (!meta || meta.resizable === false) return prefs;
  const widths = { ...prefs.widths };
  const value = clampWidth(px);
  if (value === defaultWidth(meta)) delete widths[key];
  else widths[key] = value;
  return { ...prefs, widths };
}

export function resetColumnWidth(prefs: TablePrefs, key: string): TablePrefs {
  const widths = { ...prefs.widths };
  delete widths[key];
  return { ...prefs, widths };
}

/** «Restablecer columnas»: orden, visibilidad y fijas vuelven a lo normal; los anchos se conservan. */
export const resetColumns = (prefs: TablePrefs): TablePrefs => ({ ...emptyPrefs(), widths: prefs.widths });
export const resetWidths = (prefs: TablePrefs): TablePrefs => ({ ...prefs, widths: {} });

export const isDefaultPrefs = (prefs: TablePrefs): boolean =>
  prefs.order.length === 0 && prefs.hidden.length === 0 && prefs.shown.length === 0 && prefs.pinned.length === 0 && Object.keys(prefs.widths).length === 0;

/** Una forma estable para comparar y guardar (las claves de los anchos ordenadas). */
export function canonicalPrefs(prefs: TablePrefs): string {
  const widths = Object.fromEntries(Object.entries(prefs.widths).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ order: prefs.order, hidden: [...prefs.hidden].sort(), shown: [...prefs.shown].sort(), pinned: prefs.pinned, widths });
}

export const prefsEqual = (a: TablePrefs, b: TablePrefs): boolean => canonicalPrefs(a) === canonicalPrefs(b);

/** Lo que muestra el menú de columnas, agrupado (con el buscador). Sin búsqueda, un solo grupo por `group` en el orden del menú. */
export function menuSections(metas: readonly ColumnMeta[], prefs: TablePrefs, query: string): Array<{ group: string; label: string; keys: string[] }> {
  const q = query.trim().toLowerCase();
  const byKey = new Map(metas.map((m) => [m.key, m]));
  const keys = orderedKeys(metas, prefs).filter((k) => !q || byKey.get(k)!.label.toLowerCase().includes(q));
  const out: Array<{ group: string; label: string; keys: string[] }> = [];
  for (const key of keys) {
    const group = byKey.get(key)!.group ?? "";
    let section = out.find((s) => s.group === group);
    if (!section) {
      section = { group, label: group, keys: [] };
      out.push(section);
    }
    section.keys.push(key);
  }
  return out;
}
