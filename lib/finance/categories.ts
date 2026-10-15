/**
 * Las categorías de gasto (GF3, GF4). Viven en `workspaces.finance_settings.expense_categories` (jsonb), no
 * en una tabla: `[{ key, name, color, group, system, archived_at }]`.
 *
 *  - `key` es el `system_key` de las 12 precargadas o un slug para las nuevas, y NO cambia nunca (los gastos
 *    la guardan en `category_key`).
 *  - las 12 precargadas (`system = true`) se renombran, recolorean y cambian de grupo, pero no se archivan:
 *    los gastos automáticos las usan.
 *  - nada se borra: se archiva, y una archivada no se ofrece en gastos nuevos.
 *  - el grupo se LEE de la categoría, no se copia al gasto: reclasificar una categoría reclasifica su
 *    historia en el panel (decisión D6).
 */
import { z } from "zod";

export const CATEGORY_GROUPS = ["adquisicion", "entrega", "operacion", "otro"] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export const CATEGORY_GROUP_LABELS: Record<CategoryGroup, string> = {
  adquisicion: "Adquisición",
  entrega: "Entrega",
  operacion: "Operación",
  otro: "Otro",
};

export const CATEGORY_GROUP_HINTS: Record<CategoryGroup, string> = {
  adquisicion: "Lo que cuesta conseguir clientes; es lo que usa el costo de adquisición.",
  entrega: "Lo que cuesta cumplir lo que se vendió.",
  operacion: "Lo que cuesta tener el negocio andando.",
  otro: "Impuestos y todo lo que no entra en los otros grupos.",
};

/** La paleta de colores que ofrece la pantalla. */
export const CATEGORY_COLORS = [
  "#2563eb", "#7c3aed", "#db2777", "#0d9488", "#16a34a", "#ca8a04", "#ea580c", "#4f46e5", "#0891b2", "#64748b", "#78716c", "#e11d48",
] as const;

export interface ExpenseCategory {
  key: string;
  name: string;
  color: string;
  group: CategoryGroup;
  system: boolean;
  archived_at: string | null;
}

export const CATEGORY_KEY_RE = /^[a-z0-9_]{2,40}$/;
export const CATEGORY_NAME_MAX = 80;

export const expenseCategorySchema = z.object({
  key: z.string().regex(CATEGORY_KEY_RE),
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  group: z.enum(CATEGORY_GROUPS),
  system: z.boolean(),
  archived_at: z.string().nullable(),
});

/** Las 12 precargadas. La misma lista está como default de la columna en la migración 00225 (un test las compara). */
export const DEFAULT_EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  { key: "ads_meta", name: "Publicidad (Meta)", color: "#2563eb", group: "adquisicion", system: true, archived_at: null },
  { key: "marketing", name: "Marketing y contenido", color: "#7c3aed", group: "adquisicion", system: true, archived_at: null },
  { key: "sales_team", name: "Equipo de ventas", color: "#db2777", group: "adquisicion", system: true, archived_at: null },
  { key: "commissions", name: "Comisiones del equipo", color: "#e11d48", group: "adquisicion", system: true, archived_at: null },
  { key: "delivery_team", name: "Equipo de entrega", color: "#0d9488", group: "entrega", system: true, archived_at: null },
  { key: "delivery_tools", name: "Herramientas de entrega", color: "#16a34a", group: "entrega", system: true, archived_at: null },
  { key: "software", name: "Software y suscripciones", color: "#ca8a04", group: "operacion", system: true, archived_at: null },
  { key: "processor_fees", name: "Comisiones de procesador", color: "#ea580c", group: "operacion", system: true, archived_at: null },
  { key: "professional", name: "Contabilidad y legal", color: "#4f46e5", group: "operacion", system: true, archived_at: null },
  { key: "admin_team", name: "Equipo administrativo", color: "#0891b2", group: "operacion", system: true, archived_at: null },
  { key: "taxes", name: "Impuestos", color: "#64748b", group: "otro", system: true, archived_at: null },
  { key: "other", name: "Otros", color: "#78716c", group: "otro", system: true, archived_at: null },
];

/** Lee lo guardado. Nunca lanza: una entrada inválida se descarta; sin ninguna usable, las precargadas. */
export function parseCategories(json: unknown): ExpenseCategory[] {
  if (!Array.isArray(json)) return DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c }));
  const seen = new Set<string>();
  const out: ExpenseCategory[] = [];
  for (const raw of json) {
    const parsed = expenseCategorySchema.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.key)) continue;
    seen.add(parsed.data.key);
    out.push(parsed.data);
  }
  return out.length > 0 ? out : DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c }));
}

export function activeCategories(categories: readonly ExpenseCategory[]): ExpenseCategory[] {
  return categories.filter((c) => !c.archived_at);
}

export function findCategory(categories: readonly ExpenseCategory[], key: string | null | undefined): ExpenseCategory | null {
  return categories.find((c) => c.key === key) ?? null;
}

/** El nombre; una archivada lleva "(archivada)" para que no parezca una activa. Una clave desconocida se muestra tal cual. */
export function categoryName(categories: readonly ExpenseCategory[], key: string | null | undefined): string {
  if (!key) return "—";
  const c = findCategory(categories, key);
  if (!c) return key;
  return c.archived_at ? `${c.name} (archivada)` : c.name;
}

export function categoryGroup(categories: readonly ExpenseCategory[], key: string | null | undefined): CategoryGroup {
  return findCategory(categories, key)?.group ?? "otro";
}

/** Slug sin tildes para una categoría nueva; si existe, `_2`, `_3`… */
export function newCategoryKey(name: string, existing: readonly string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 34) || "categoria";
  const root = base.length >= 2 ? base : `${base}_x`;
  const taken = new Set(existing);
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${root}_${n}`)) return `${root}_${n}`;
  return `${root}_${Date.now()}`;
}

export type CategoriesUpdateResult = { ok: true } | { ok: false; error: string };

/**
 * Qué se puede hacer con la lista al guardar. No se quita una categoría ni se cambia su `key`; los nombres
 * son únicos entre las activas (sin importar mayúsculas); una de sistema no se archiva; una categoría usada
 * por una plantilla activa no se archiva (`usedByRecurring`: nombres de las plantillas por categoría).
 */
export function validateCategoriesUpdate(
  before: readonly ExpenseCategory[],
  after: readonly ExpenseCategory[],
  usedByRecurring: Readonly<Record<string, readonly string[]>> = {},
): CategoriesUpdateResult {
  const afterByKey = new Map(after.map((c) => [c.key, c]));
  if (afterByKey.size !== after.length) return { ok: false, error: "Hay dos categorías con la misma clave" };
  for (const old of before) {
    const now = afterByKey.get(old.key);
    if (!now) return { ok: false, error: `No se puede quitar «${old.name}»: archivala para que no se ofrezca más` };
    if (old.system && !now.system) return { ok: false, error: `«${old.name}» es una categoría del sistema` };
    if (now.system && now.archived_at) return { ok: false, error: `«${now.name}» no se puede archivar: la usan los gastos automáticos` };
    if (!old.archived_at && now.archived_at) {
      const plantillas = usedByRecurring[old.key] ?? [];
      if (plantillas.length > 0) {
        return { ok: false, error: `«${old.name}» la usan ${plantillas.length === 1 ? "la plantilla" : "las plantillas"} ${plantillas.map((p) => `«${p}»`).join(", ")}: cambialas o pausalas antes de archivarla` };
      }
    }
  }
  const names = new Set<string>();
  for (const c of after) {
    if (c.archived_at) continue;
    const n = c.name.trim().toLowerCase();
    if (names.has(n)) return { ok: false, error: `Ya hay una categoría activa llamada «${c.name.trim()}»` };
    names.add(n);
  }
  return { ok: true };
}
