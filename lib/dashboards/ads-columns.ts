/**
 * Que columnas ve cada persona en la tabla «Meta vs CRM» y en que orden (Extra L, AT4, F31).
 *
 * Se guarda POR PERSONA y POR PESTAÑA (campañas, conjuntos, anuncios) en `localStorage`, con la clave
 * `ssa:ads-columns:<nivel>`. Es una comodidad, no un dato: **todo acceso a `localStorage` va en `try/catch`**
 * (puede lanzar en una ventana privada o con los datos del sitio bloqueados) y, si falla o lo guardado esta roto,
 * se vuelve a las columnas por defecto. La pantalla se ve bien sin nada guardado.
 *
 * El orden se mueve DENTRO del grupo (una columna de «Meta» no pasa a «CRM»): los tres grupos siempre se ven en
 * el mismo orden y con su encabezado de color.
 *
 * Modulo puro: recibe el `Storage` (o algo parecido) por parametro, asi se prueba sin navegador.
 */

import { ALL_COLUMN_IDS, COLUMN_BY_ID, COLUMNS, GROUP_ORDER, columnsOfGroup, type ColumnDef, type ColumnGroup, type ColumnId } from "./ads-crm-columns";

export type ColumnLevel = "campaign" | "adset" | "ad";

export interface ColumnPrefs {
  /** Todas las columnas, en el orden elegido (dentro de cada grupo). */
  order: ColumnId[];
  /** Las que se ven. */
  visible: ColumnId[];
}

export const storageKey = (level: ColumnLevel) => `ssa:ads-columns:${level}`;

/** Lo minimo que se necesita de `window.localStorage`. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Las columnas por defecto: todas en su orden y las marcadas como `defaultVisible`. */
export function defaultPrefs(): ColumnPrefs {
  return {
    order: [...ALL_COLUMN_IDS],
    visible: COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id),
  };
}

const isColumnId = (value: unknown): value is ColumnId => typeof value === "string" && value in COLUMN_BY_ID;

/**
 * Lee lo guardado SIN confiar en el: lo que no es una columna conocida se descarta, lo repetido se quita, y una
 * columna que se sumo despues de guardar se agrega al final de su grupo y oculta (no cambia lo que la persona ve).
 */
export function parsePrefs(raw: string | null | undefined): ColumnPrefs {
  const defaults = defaultPrefs();
  if (!raw) return defaults;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!parsed || typeof parsed !== "object") return defaults;
  const { order, visible } = parsed as { order?: unknown; visible?: unknown };
  if (!Array.isArray(order) || !Array.isArray(visible)) return defaults;

  const seen = new Set<ColumnId>();
  const cleanOrder: ColumnId[] = [];
  for (const id of order) {
    if (isColumnId(id) && !seen.has(id)) {
      seen.add(id);
      cleanOrder.push(id);
    }
  }
  // Una columna nueva (sumada despues de guardar): al final, oculta.
  for (const id of ALL_COLUMN_IDS) if (!seen.has(id)) cleanOrder.push(id);

  const cleanVisible = [...new Set(visible.filter(isColumnId))];
  // Si no quedo ninguna visible, no se deja la tabla sin columnas: se vuelve a lo de siempre.
  if (cleanVisible.length === 0) return defaults;
  return { order: cleanOrder, visible: cleanVisible };
}

export function serializePrefs(prefs: ColumnPrefs): string {
  return JSON.stringify({ order: prefs.order, visible: prefs.visible });
}

/** Lo guardado para este nivel, o las columnas por defecto. Nunca lanza. */
export function loadPrefs(level: ColumnLevel, storage: KeyValueStorage | null | undefined): ColumnPrefs {
  try {
    return parsePrefs(storage?.getItem(storageKey(level)));
  } catch {
    return defaultPrefs();
  }
}

/** Guarda. Devuelve false si no se pudo (almacenamiento bloqueado o lleno): la pantalla sigue andando. */
export function savePrefs(level: ColumnLevel, prefs: ColumnPrefs, storage: KeyValueStorage | null | undefined): boolean {
  try {
    if (!storage) return false;
    storage.setItem(storageKey(level), serializePrefs(prefs));
    return true;
  } catch {
    return false;
  }
}

/** Las columnas que se ven, en orden: los grupos en su orden y, adentro, el que eligio la persona. */
export function visibleColumns(prefs: ColumnPrefs): ColumnDef[] {
  const visible = new Set(prefs.visible);
  const rank = new Map(prefs.order.map((id, index) => [id, index]));
  const byGroup = (group: ColumnGroup) =>
    columnsOfGroup(group)
      .filter((c) => visible.has(c.id))
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return GROUP_ORDER.flatMap(byGroup);
}

/** Las columnas de un grupo en el orden elegido (se vean o no), para el selector. */
export function orderedGroup(prefs: ColumnPrefs, group: ColumnGroup): ColumnDef[] {
  const rank = new Map(prefs.order.map((id, index) => [id, index]));
  return columnsOfGroup(group).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

/** Prende o apaga una columna. No deja la tabla sin ninguna columna visible. */
export function toggleColumn(prefs: ColumnPrefs, id: ColumnId): ColumnPrefs {
  const isVisible = prefs.visible.includes(id);
  if (isVisible && prefs.visible.length === 1) return prefs;
  return { ...prefs, visible: isVisible ? prefs.visible.filter((v) => v !== id) : [...prefs.visible, id] };
}

/** Mueve una columna una posicion arriba o abajo DENTRO de su grupo (con las flechas del selector). */
export function moveColumn(prefs: ColumnPrefs, id: ColumnId, direction: -1 | 1): ColumnPrefs {
  const def = COLUMN_BY_ID[id];
  if (!def) return prefs;
  const group = orderedGroup(prefs, def.group).map((c) => c.id);
  const from = group.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= group.length) return prefs;

  const reordered = [...group];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];

  // El orden global se rearma grupo por grupo, para que las columnas de otros grupos no se muevan.
  const order = GROUP_ORDER.flatMap((g) => (g === def.group ? reordered : orderedGroup(prefs, g).map((c) => c.id)));
  return { ...prefs, order };
}

export const resetPrefs = (): ColumnPrefs => defaultPrefs();
