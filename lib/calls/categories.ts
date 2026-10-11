/**
 * Categorias de dolores, deseos, objeciones y razones (F27). Puro.
 *
 * No hay tabla de propuestas: la propuesta viene dentro del analisis de cada
 * llamada (`propuesta: true` en la categoria) y la bandeja es una LECTURA
 * agrupada. Las decisiones (aceptar, unir, descartar) viven en
 * `call_analysis.categories` y NO reescriben ningun analisis: las llamadas
 * conservan la categoria que dijo la IA, y la pantalla, el dashboard y las
 * condiciones de flujo la mapean al mostrar con `effectiveCategory`.
 */
import { CATEGORY_GROUPS, CATEGORY_PATH, allowedCategoryKeys, closestCategory, slugKey, type CallCategories, type Category, type CategoryGroup } from "./rubric";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Deja cada categoria del analisis en una de dos cosas: una de la lista aceptada
 * (o "otra"), o —solo si el negocio lo permite— una propuesta marcada. Con las
 * categorias nuevas apagadas, todo lo que no esta en la lista pasa a "otra".
 */
export function sanitizeAnalysisCategories<T>(analysis: T, categories: CallCategories, allowNew: boolean): T {
  if (!isObj(analysis)) return analysis;
  const out: Obj = { ...analysis };
  for (const g of CATEGORY_GROUPS) {
    const path = CATEGORY_PATH[g];
    const node = out[path];
    if (!isObj(node) || typeof node.categoria !== "string") continue;
    const raw = node.categoria.trim();
    const allowed = allowedCategoryKeys(categories, g);
    const known = allowed.includes(raw) || allowed.includes(slugKey(raw));
    if (known) {
      out[path] = { ...node, categoria: allowed.includes(raw) ? raw : slugKey(raw), propuesta: false };
    } else if (allowNew && raw) {
      out[path] = { ...node, categoria: raw, propuesta: true };
    } else {
      out[path] = { ...node, categoria: "otra", propuesta: false };
    }
  }
  return out as T;
}

export interface CategoryRow {
  id: string;
  recorded_at: string;
  analysis: unknown;
}

export interface CategoryProposal {
  group: CategoryGroup;
  /** La clave normalizada con la que se acepta, une o descarta. */
  key: string;
  /** Como la escribio la IA. */
  name: string;
  calls: number;
  lastAt: string;
  /** La categoria aceptada mas parecida, para sugerir unirla. */
  suggestion: Category | null;
}

export function groupCategoryProposals(rows: CategoryRow[], categories: CallCategories): CategoryProposal[] {
  const found = new Map<string, CategoryProposal & { ids: Set<string> }>();
  for (const row of rows) {
    if (!isObj(row.analysis)) continue;
    for (const g of CATEGORY_GROUPS) {
      const node = row.analysis[CATEGORY_PATH[g]];
      if (!isObj(node) || node.propuesta !== true || typeof node.categoria !== "string") continue;
      const name = node.categoria.trim();
      const key = slugKey(name);
      if (!key || key === "otra") continue;
      if (categories.accepted[g].some((c) => c.clave === key)) continue;
      if (categories.discarded[g].includes(key)) continue;
      if (key in categories.merged[g]) continue;

      const id = `${g}:${key}`;
      const entry = found.get(id) ?? { group: g, key, name, calls: 0, lastAt: row.recorded_at, suggestion: closestCategory(name, categories.accepted[g]), ids: new Set<string>() };
      entry.ids.add(row.id);
      entry.calls = entry.ids.size;
      if (row.recorded_at > entry.lastAt) entry.lastAt = row.recorded_at;
      found.set(id, entry);
    }
  }
  return [...found.values()]
    .map(({ ids: _ids, ...p }) => p)
    .sort((a, b) => b.calls - a.calls || (a.lastAt < b.lastAt ? 1 : -1) || a.name.localeCompare(b.name, "es"));
}

export type EffectiveKind = "accepted" | "merged" | "discarded" | "proposed" | "other";

/** Como se muestra la categoria que dijo la IA, segun las decisiones tomadas. */
export function effectiveCategory(group: CategoryGroup, key: string | null | undefined, categories: CallCategories): { key: string; label: string; kind: EffectiveKind } {
  const raw = (key ?? "").trim();
  if (!raw || raw === "otra") return { key: "otra", label: "Otra", kind: "other" };
  const norm = slugKey(raw);
  const accepted = categories.accepted[group].find((c) => c.clave === raw || c.clave === norm);
  if (accepted) return { key: accepted.clave, label: accepted.nombre, kind: "accepted" };
  const target = categories.merged[group][raw] ?? categories.merged[group][norm];
  if (target) {
    const dest = categories.accepted[group].find((c) => c.clave === target);
    return { key: target, label: dest?.nombre ?? target, kind: "merged" };
  }
  if (categories.discarded[group].includes(norm) || categories.discarded[group].includes(raw)) return { key: "otra", label: "Otra", kind: "discarded" };
  return { key: norm, label: raw.replace(/_/g, " "), kind: "proposed" };
}

export function acceptProposal(categories: CallCategories, group: CategoryGroup, key: string, name: string): CallCategories {
  const next = structuredClone(categories);
  if (!next.accepted[group].some((c) => c.clave === key)) next.accepted[group].push({ clave: key, nombre: name.trim() || key });
  next.discarded[group] = next.discarded[group].filter((k) => k !== key);
  return next;
}

export function mergeProposal(categories: CallCategories, group: CategoryGroup, key: string, targetKey: string): CallCategories | null {
  if (key === targetKey || !categories.accepted[group].some((c) => c.clave === targetKey && !c.archivado)) return null;
  const next = structuredClone(categories);
  next.merged[group][key] = targetKey;
  return next;
}

export function discardProposal(categories: CallCategories, group: CategoryGroup, key: string): CallCategories {
  const next = structuredClone(categories);
  if (!next.discarded[group].includes(key)) next.discarded[group].push(key);
  return next;
}
