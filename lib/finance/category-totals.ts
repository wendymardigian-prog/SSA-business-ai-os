/**
 * Lo que muestra la tarjeta de Categorías de Ajustes > Finanzas (GF4): cuántos gastos tiene cada una y cuánto se
 * pagó en el año, en CÉNTIMOS; las categorías ordenadas por grupo; y cómo se arma lo que se manda a
 * `saveExpenseCategories`. Puro: el componente solo lo compone.
 */
import { toCents } from "@/lib/shared/money";
import {
  CATEGORY_COLORS, CATEGORY_GROUPS, CATEGORY_GROUP_HINTS, CATEGORY_GROUP_LABELS, CATEGORY_NAME_MAX, type CategoryGroup, type ExpenseCategory,
} from "./categories";

export interface CategoryExpenseRow {
  category_key: string;
  amount: unknown;
  status: string;
  paid_date: string | null;
}

export interface CategoryUsage {
  /** Gastos de la categoría, sin contar los anulados. */
  count: number;
  /** Pagado en el año civil de `todayLocal`. */
  paidYearCents: number;
}

export const NO_USAGE: CategoryUsage = { count: 0, paidYearCents: 0 };

export function categoryUsage(rows: readonly CategoryExpenseRow[], todayLocal: string): Record<string, CategoryUsage> {
  const year = todayLocal.slice(0, 4);
  const out: Record<string, CategoryUsage> = {};
  for (const r of rows) {
    if (r.status === "anulado") continue;
    const u = (out[r.category_key] ??= { count: 0, paidYearCents: 0 });
    u.count += 1;
    if (r.status === "pagado" && r.paid_date && r.paid_date.slice(0, 4) === year) u.paidYearCents += toCents(r.amount);
  }
  return out;
}

export interface CategorySection {
  group: CategoryGroup;
  label: string;
  hint: string;
  items: ExpenseCategory[];
}

/** Las categorías por grupo, en el orden de los grupos; un grupo sin categorías no se dibuja. */
export function categorySections(categories: readonly ExpenseCategory[]): CategorySection[] {
  return CATEGORY_GROUPS.map((group) => ({
    group,
    label: CATEGORY_GROUP_LABELS[group],
    hint: CATEGORY_GROUP_HINTS[group],
    items: categories.filter((c) => c.group === group).sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at)),
  })).filter((s) => s.items.length > 0);
}

// ── Guardar ─────────────────────────────────────────────────────────────

/** La forma que recibe `saveExpenseCategories` (sin `system` ni `archived_at`: los decide el servidor). */
export interface CategorySaveItem {
  key?: string;
  name: string;
  color: (typeof CATEGORY_COLORS)[number];
  group: CategoryGroup;
  archived: boolean;
}

export interface CategoryDraft {
  key: string | null;
  name: string;
  color: string;
  group: CategoryGroup;
}

export const EMPTY_CATEGORY_DRAFT: CategoryDraft = { key: null, name: "", color: CATEGORY_COLORS[0], group: "operacion" };

export function draftFromCategory(c: ExpenseCategory): CategoryDraft {
  return { key: c.key, name: c.name, color: c.color, group: c.group };
}

const paletteColor = (color: string): CategorySaveItem["color"] => {
  const lower = color.toLowerCase();
  return (CATEGORY_COLORS as readonly string[]).includes(lower) ? (lower as CategorySaveItem["color"]) : CATEGORY_COLORS[0];
};

export function toSaveItems(categories: readonly ExpenseCategory[]): CategorySaveItem[] {
  return categories.map((c) => ({ key: c.key, name: c.name, color: paletteColor(c.color), group: c.group, archived: !!c.archived_at }));
}

/** Crear o editar: devuelve la lista completa para guardar (una nueva va al final, sin `key`). */
export function itemsWithDraft(categories: readonly ExpenseCategory[], draft: CategoryDraft): CategorySaveItem[] {
  const items = toSaveItems(categories);
  const next: CategorySaveItem = { key: draft.key ?? undefined, name: draft.name.trim(), color: paletteColor(draft.color), group: draft.group, archived: false };
  if (!draft.key) return [...items, next];
  return items.map((i) => (i.key === draft.key ? { ...next, archived: i.archived } : i));
}

/** Archivar o restaurar una categoría: la lista completa con ese cambio. */
export function itemsWithArchived(categories: readonly ExpenseCategory[], key: string, archived: boolean): CategorySaveItem[] {
  return toSaveItems(categories).map((i) => (i.key === key ? { ...i, archived } : i));
}

/** Validación rápida antes de mandar (el servidor vuelve a validar: nombres únicos, categorías de sistema…). */
export function categoryDraftError(draft: CategoryDraft, categories: readonly ExpenseCategory[]): string | null {
  const name = draft.name.trim();
  if (!name) return "Poné un nombre";
  if (name.length > CATEGORY_NAME_MAX) return `El nombre puede tener hasta ${CATEGORY_NAME_MAX} caracteres`;
  const clash = categories.find((c) => !c.archived_at && c.key !== draft.key && c.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) return `Ya hay una categoría activa llamada «${clash.name}»`;
  return null;
}

/** Una categoría del sistema se renombra pero no se archiva (los gastos automáticos la usan). */
export const canArchiveCategory = (c: Pick<ExpenseCategory, "system" | "archived_at">): boolean => !c.system && !c.archived_at;

/** El nombre de cada color de la paleta, para el lector de pantalla (un círculo de color solo no dice nada). */
export const CATEGORY_COLOR_NAMES: Record<(typeof CATEGORY_COLORS)[number], string> = {
  "#2563eb": "Azul",
  "#7c3aed": "Violeta",
  "#db2777": "Rosa",
  "#0d9488": "Verde azulado",
  "#16a34a": "Verde",
  "#ca8a04": "Mostaza",
  "#ea580c": "Naranja",
  "#4f46e5": "Índigo",
  "#0891b2": "Celeste",
  "#64748b": "Gris azulado",
  "#78716c": "Gris piedra",
  "#e11d48": "Rojo",
};
