/**
 * Que columnas ve cada persona en la tabla «Meta vs CRM» y en que orden (Extra L, AT4, F31; Tirón 2, E4).
 *
 * Se guarda POR PERSONA y POR PESTAÑA (campañas, conjuntos, anuncios) en `localStorage`, con la clave
 * `ssa:ads-columns:<nivel>`. Es una comodidad, no un dato: **todo acceso a `localStorage` va en `try/catch`**
 * (puede lanzar en una ventana privada o con los datos del sitio bloqueados) y, si falla o lo guardado esta roto,
 * se vuelve a las columnas por defecto. La pantalla se ve bien sin nada guardado.
 *
 * El orden se mueve DENTRO del grupo (una columna de «Meta» no pasa a «CRM») y, en Meta, dentro de su subtítulo
 * (Entrega, Clics, Video…): los grupos siempre se ven en el mismo orden y con su encabezado de color.
 *
 * Lo ya guardado se respeta al cambiar el catálogo (`parsePrefs`):
 *  - quien NUNCA tocó las columnas no tiene nada guardado: ve el default nuevo;
 *  - quien ya eligió las suyas conserva su elección, y las columnas nuevas le aparecen OCULTAS (al final de su bloque);
 *  - una columna guardada que ya no existe se reemplaza por su equivalente (`REPLACED_COLUMNS`), nunca rompe la tabla.
 *
 * Modulo puro: recibe el `Storage` (o algo parecido) por parametro, asi se prueba sin navegador.
 */

import {
  ALL_COLUMN_IDS,
  COLUMN_BY_ID,
  COLUMNS,
  GROUP_LABEL,
  GROUP_ORDER,
  SUBGROUP_LABEL,
  SUBGROUP_ORDER,
  columnAppliesTo,
  columnsOfGroup,
  type ColumnDef,
  type ColumnGroup,
  type ColumnId,
  type MetaSubgroup,
} from "./ads-crm-columns";

export type ColumnLevel = "campaign" | "adset" | "ad";

export interface ColumnPrefs {
  /** Todas las columnas, en el orden elegido (dentro de cada bloque). */
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

/**
 * Las columnas que se reemplazaron al unificar el catálogo (Tirón 2): lo que la persona ya había elegido pasa a su equivalente.
 * Dos columnas viejas pueden ir a la misma nueva. `cplReal` se reparte en las dos nuevas (CPL nuevo y CPL total).
 */
export const REPLACED_COLUMNS: Readonly<Record<string, readonly ColumnId[]>> = {
  cplReal: ["cplNew", "cplTotal"],
  leadsCrm: ["leadsTotal"],
  leadsFirst: ["leadsNew"],
  bookingsCrm: ["bookings"],
  cac: ["costPerNewDeal"],
  costPerClose: ["costPerNewDeal"],
  conversions: ["purchasesMeta"],
};

/** Las columnas por defecto: todas en su orden y las marcadas como `defaultVisible`. */
export function defaultPrefs(): ColumnPrefs {
  return {
    order: [...ALL_COLUMN_IDS],
    visible: COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id),
  };
}

const isColumnId = (value: unknown): value is ColumnId => typeof value === "string" && value in COLUMN_BY_ID;

/** El «bloque» de una columna: donde se puede mover (el grupo y, en Meta, su subtítulo). */
const blockOf = (id: ColumnId): string => {
  const def = COLUMN_BY_ID[id];
  return def.subgroup ? `${def.group}:${def.subgroup}` : def.group;
};

/** Cada id viejo a lo que lo reemplaza; un id desconocido sin reemplazo, a nada. */
function mapId(id: unknown): ColumnId[] {
  if (isColumnId(id)) return [id];
  if (typeof id === "string" && id in REPLACED_COLUMNS) return [...REPLACED_COLUMNS[id]];
  return [];
}

/**
 * Lee lo guardado SIN confiar en el: lo que no es una columna conocida se reemplaza por su equivalente (o se descarta),
 * lo repetido se quita, y una columna que se sumo despues de guardar se agrega al final de su bloque y oculta (no cambia
 * lo que la persona ve).
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
  for (const raw of order) {
    for (const id of mapId(raw)) {
      if (!seen.has(id)) {
        seen.add(id);
        cleanOrder.push(id);
      }
    }
  }

  // Una columna nueva (sumada despues de guardar): al final de su bloque, oculta.
  for (const id of ALL_COLUMN_IDS) {
    if (seen.has(id)) continue;
    seen.add(id);
    const block = blockOf(id);
    let at = -1;
    cleanOrder.forEach((other, index) => {
      if (blockOf(other) === block) at = index;
    });
    if (at < 0) cleanOrder.forEach((other, index) => {
      if (COLUMN_BY_ID[other].group === COLUMN_BY_ID[id].group) at = index;
    });
    if (at < 0) cleanOrder.push(id);
    else cleanOrder.splice(at + 1, 0, id);
  }

  const cleanVisible = [...new Set(visible.flatMap(mapId))];
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

/** Las columnas que se ven en esta pestaña, en orden: los grupos en su orden y, adentro, el que eligio la persona. */
export function visibleColumns(prefs: ColumnPrefs, level: ColumnLevel = "ad"): ColumnDef[] {
  const visible = new Set(prefs.visible);
  const rank = new Map(prefs.order.map((id, index) => [id, index]));
  const byGroup = (group: ColumnGroup) =>
    columnsOfGroup(group)
      .filter((c) => visible.has(c.id) && columnAppliesTo(c, level))
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return GROUP_ORDER.flatMap(byGroup);
}

/** Las columnas de un grupo (de esta pestaña) en el orden elegido (se vean o no), para el selector. */
export function orderedGroup(prefs: ColumnPrefs, group: ColumnGroup, level: ColumnLevel = "ad"): ColumnDef[] {
  const rank = new Map(prefs.order.map((id, index) => [id, index]));
  return columnsOfGroup(group)
    .filter((c) => columnAppliesTo(c, level))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

/** Prende o apaga una columna. No deja la tabla sin ninguna columna visible EN ESTA PESTAÑA. */
export function toggleColumn(prefs: ColumnPrefs, id: ColumnId, level: ColumnLevel = "ad"): ColumnPrefs {
  const isVisible = prefs.visible.includes(id);
  if (isVisible) {
    const stillVisible = visibleColumns(prefs, level).filter((c) => c.id !== id);
    if (stillVisible.length === 0) return prefs;
  }
  return { ...prefs, visible: isVisible ? prefs.visible.filter((v) => v !== id) : [...prefs.visible, id] };
}

/** Las columnas del bloque de `id` que aplican a la pestaña, en el orden elegido. */
function blockMembers(prefs: ColumnPrefs, id: ColumnId, level: ColumnLevel): ColumnId[] {
  const def = COLUMN_BY_ID[id];
  return orderedGroup(prefs, def.group, level)
    .filter((c) => c.subgroup === def.subgroup)
    .map((c) => c.id);
}

/** Rearma el orden global con un nuevo orden para UN bloque; las columnas de los demas no se mueven. */
function withBlockOrder(prefs: ColumnPrefs, reordered: ColumnId[]): ColumnPrefs {
  const members = new Set(reordered);
  // Se reemplazan, en las mismas posiciones que ocupaban, por el nuevo orden del bloque.
  const slots = prefs.order.map((other, index) => (members.has(other) ? index : -1)).filter((index) => index >= 0);
  const order = [...prefs.order];
  slots.forEach((slot, index) => {
    order[slot] = reordered[index];
  });
  return { ...prefs, order };
}

/** Mueve una columna una posicion arriba o abajo DENTRO de su bloque (con las flechas del selector: con teclado funciona igual). */
export function moveColumn(prefs: ColumnPrefs, id: ColumnId, direction: -1 | 1, level: ColumnLevel = "ad"): ColumnPrefs {
  if (!COLUMN_BY_ID[id]) return prefs;
  const members = blockMembers(prefs, id, level);
  const from = members.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= members.length) return prefs;
  const reordered = [...members];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  return withBlockOrder(prefs, reordered);
}

/**
 * Arrastrar: pone `id` en el lugar de `targetId` (antes si viene de abajo, despues si viene de arriba), solo si estan
 * en el mismo bloque. Las flechas siguen existiendo: esto es un atajo, no el unico camino.
 */
export function moveColumnTo(prefs: ColumnPrefs, id: ColumnId, targetId: ColumnId, level: ColumnLevel = "ad"): ColumnPrefs {
  if (id === targetId || !COLUMN_BY_ID[id] || !COLUMN_BY_ID[targetId]) return prefs;
  if (blockOf(id) !== blockOf(targetId)) return prefs;
  const members = blockMembers(prefs, id, level);
  const from = members.indexOf(id);
  const to = members.indexOf(targetId);
  if (from < 0 || to < 0) return prefs;
  const reordered = members.filter((m) => m !== id);
  reordered.splice(to, 0, id);
  return withBlockOrder(prefs, reordered);
}

export const resetPrefs = (): ColumnPrefs => defaultPrefs();

// ── El buscador y los subtítulos del selector ───────────────────────────────

/** Sin acentos, en minúsculas: «Retención» y «retencion» son lo mismo para buscar. */
export const normalizeSearch = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** ¿La columna coincide con lo escrito? Busca en su nombre, el título de su explicación, su grupo y su subtítulo. */
export function columnMatches(def: ColumnDef, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const haystack = normalizeSearch(
    [def.label, def.tip.title, GROUP_LABEL[def.group], def.subgroup ? SUBGROUP_LABEL[def.subgroup] : ""].join(" "),
  );
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

export interface MenuSection {
  /** Solo en Meta: Entrega, Clics, Video, Conversiones, Calidad. */
  subgroup: MetaSubgroup | null;
  label: string | null;
  columns: ColumnDef[];
}

export interface MenuGroup {
  group: ColumnGroup;
  label: string;
  sections: MenuSection[];
}

/** Lo que dibuja el selector: los grupos, con subtítulos en Meta, filtrados por lo que se busca. Los vacíos no salen. */
export function menuGroups(prefs: ColumnPrefs, level: ColumnLevel, query = ""): MenuGroup[] {
  const out: MenuGroup[] = [];
  for (const group of GROUP_ORDER) {
    const columns = orderedGroup(prefs, group, level).filter((c) => columnMatches(c, query));
    if (columns.length === 0) continue;
    if (group !== "meta") {
      out.push({ group, label: GROUP_LABEL[group], sections: [{ subgroup: null, label: null, columns }] });
      continue;
    }
    const sections = SUBGROUP_ORDER.map((subgroup) => ({
      subgroup,
      label: SUBGROUP_LABEL[subgroup],
      columns: columns.filter((c) => c.subgroup === subgroup),
    })).filter((s) => s.columns.length > 0);
    out.push({ group, label: GROUP_LABEL[group], sections });
  }
  return out;
}
