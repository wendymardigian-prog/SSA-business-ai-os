/**
 * Lógica pura de la lista de formularios (F3): filas, slugs y transiciones.
 */
import { slugify } from "@/lib/scheduling/slug";
import { FORM_STATUSES, FORM_TYPES, type FormStatus, type FormType } from "./fields";

export { defaultDefinition } from "./fields";

export const SLUG_PATTERN = /^[a-z0-9-]{3,60}$/;

export interface FormStats {
  submissions: number;
  lastSubmissionAt: string | null;
}

export interface FormListSource {
  id: string;
  name: string;
  type: FormType;
  status: FormStatus;
  slug: string;
  updated_at: string;
}

export interface FormListRow {
  id: string;
  name: string;
  type: FormType;
  status: FormStatus;
  slug: string;
  submissions: number;
  lastSubmissionAt: string | null;
  updatedAt: string;
}

export function formListRow(form: FormListSource, stats?: Partial<FormStats> | null): FormListRow {
  return {
    id: form.id,
    name: form.name,
    type: form.type,
    status: form.status,
    slug: form.slug,
    submissions: stats?.submissions ?? 0,
    lastSubmissionAt: stats?.lastSubmissionAt ?? null,
    updatedAt: form.updated_at,
  };
}

/** Un slug base desde un nombre, que cumple el formato (mínimo 3 caracteres). */
export function slugFromName(name: string): string {
  const base = slugify(name).slice(0, 60).replace(/-+$/, "");
  if (base.length >= 3) return base;
  return (base ? `${base}-form` : "formulario").slice(0, 60);
}

/** `base`, `base-2`, `base-3`… que no esté entre los usados (sin importar mayúsculas). */
export function nextSlug(base: string, taken: string[]): string {
  const used = new Set(taken.map((s) => s.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, 60 - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Transiciones permitidas de estado. Publicar (draft → published) se hace SOLO
 * con `publish_form_version`; por eso `published` desde `draft` figura acá pero
 * la acción de transición simple no lo usa.
 */
const ALLOWED: Record<FormStatus, FormStatus[]> = {
  draft: ["published", "archived"],
  published: ["paused", "archived"],
  paused: ["published", "archived"],
  archived: ["draft"],
};

export function canTransition(from: FormStatus, to: FormStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export type ListFilter = "published" | "draft" | "paused" | "archived";
export const LIST_FILTERS: Array<{ value: ListFilter; label: string }> = [
  { value: "published", label: "Publicados" },
  { value: "draft", label: "Borradores" },
  { value: "paused", label: "Pausados" },
  { value: "archived", label: "Archivados" },
];

export function parseListFilter(value: unknown): ListFilter {
  return FORM_STATUSES.includes(value as FormStatus) ? (value as ListFilter) : "published";
}

export function countByStatus(rows: Array<{ status: FormStatus }>): Record<ListFilter, number> {
  const counts: Record<ListFilter, number> = { published: 0, draft: 0, paused: 0, archived: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** El filtro por tipo de la lista: "all" o uno de los tipos (incluido "Fin de día"). */
export type TypeFilter = "all" | FormType;

export function parseTypeFilter(value: unknown): TypeFilter {
  return FORM_TYPES.includes(value as FormType) ? (value as FormType) : "all";
}

export function matchesType(row: { type: FormType }, filter: TypeFilter): boolean {
  return filter === "all" || row.type === filter;
}

export function duplicateName(name: string): string {
  return `Copia de ${name}`.slice(0, 120);
}
