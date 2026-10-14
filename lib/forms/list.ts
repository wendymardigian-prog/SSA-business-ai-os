/**
 * Lógica pura de la lista de formularios (F3): filas, slugs y transiciones.
 */
import { slugify } from "@/lib/scheduling/slug";
import { FORM_STATUSES, FORM_TYPES, FORM_TYPE_LABELS, type FormStatus, type FormType } from "./fields";
import { conversionRate } from "./metrics";
import { calculateAverage, calculateNPS } from "./survey-metrics";

export { defaultDefinition } from "./fields";

export const SLUG_PATTERN = /^[a-z0-9-]{3,60}$/;

export interface FormStats {
  submissions: number;
  lastSubmissionAt: string | null;
  /**
   * Vistas del formulario (las cuenta `form_metrics_daily`, igual que Metricas). `null` = no se midio:
   * la conversion queda en blanco, nunca en 0 (plano formularios-ui, F6).
   */
  views?: number | null;
  /** Los puntajes de las respuestas de una encuesta (el NPS o el promedio se calculan con `survey-metrics`). */
  scores?: number[];
  /** Solo un reporte de fin de dia: cuantas personas distintas enviaron un reporte. */
  people?: number | null;
}

export interface FormListSource {
  id: string;
  name: string;
  type: FormType;
  status: FormStatus;
  slug: string;
  updated_at: string;
  /** `forms.design`: de ahi sale el titulo publico. */
  design?: unknown;
  /** `forms.draft_definition`: de ahi sale la cantidad de preguntas. */
  draft_definition?: unknown;
  /** `forms.survey_config`: dice cual pregunta lleva el puntaje (la escala). */
  survey_config?: unknown;
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
  /** Lo que ve quien responde (`design.title`), o null si no tiene. */
  publicTitle: string | null;
  /** Preguntas del borrador, sin contar los campos ocultos. */
  questionCount: number;
  /** Envios / vistas (0 a 1), o null si no hay vistas medidas. */
  conversion: number | null;
  /** Solo encuestas con NPS: promotores - detractores (-100 a 100), o null sin respuestas. */
  nps: number | null;
  /** Solo encuestas con estrellas: el promedio, o null sin respuestas. */
  average: number | null;
  /** Solo un reporte de fin de dia: personas distintas que enviaron un reporte. */
  people: number | null;
}

/** Las preguntas del borrador que ve quien responde (los campos ocultos no cuentan). */
export function questionCountOf(definition: unknown): number {
  const fields = (definition as { fields?: unknown } | null | undefined)?.fields;
  if (!Array.isArray(fields)) return 0;
  return fields.filter((f) => (f as { type?: unknown } | null)?.type !== "hidden").length;
}

/** El titulo publico guardado en `design.title`, o null si esta vacio. */
export function publicTitleOf(design: unknown): string | null {
  const title = (design as { title?: unknown } | null | undefined)?.title;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : null;
}

export function formListRow(form: FormListSource, stats?: Partial<FormStats> | null): FormListRow {
  const submissions = stats?.submissions ?? 0;
  const scores = stats?.scores ?? [];
  // La escala sale de la pregunta de puntaje: estrellas (`rating`) o NPS. Sin configuracion de encuesta: NPS.
  const scoreKey = (form.survey_config as { scoreFieldKey?: unknown } | null | undefined)?.scoreFieldKey;
  const fields = (form.draft_definition as { fields?: Array<{ key?: unknown; type?: unknown }> } | null | undefined)?.fields;
  const scoreField = Array.isArray(fields) ? fields.find((f) => f?.key === scoreKey) : undefined;
  const stars = scoreField?.type === "rating";
  return {
    id: form.id,
    name: form.name,
    type: form.type,
    status: form.status,
    slug: form.slug,
    submissions,
    lastSubmissionAt: stats?.lastSubmissionAt ?? null,
    updatedAt: form.updated_at,
    publicTitle: publicTitleOf(form.design),
    questionCount: questionCountOf(form.draft_definition),
    conversion: form.type === "custom" || form.type === "contract" ? conversionRate(submissions, stats?.views ?? 0) : null,
    nps: form.type === "survey" && !stars && scores.length > 0 ? calculateNPS(scores) : null,
    average: form.type === "survey" && stars && scores.length > 0 ? calculateAverage(scores) : null,
    people: form.type === "eod" ? (stats?.people ?? null) : null,
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

/**
 * El filtro por estado de la lista. `"all"` (todos, tambien los archivados) es el valor por defecto
 * desde el plano formularios-ui (D-B2): antes la lista siempre filtraba por un estado.
 */
export type ListFilter = "all" | FormStatus;
export const LIST_FILTERS: Array<{ value: ListFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "published", label: "Publicados" },
  { value: "draft", label: "Borradores" },
  { value: "paused", label: "Pausados" },
  { value: "archived", label: "Archivados" },
];

export function parseListFilter(value: unknown): ListFilter {
  return FORM_STATUSES.includes(value as FormStatus) ? (value as ListFilter) : "all";
}

export function countByStatus(rows: Array<{ status: FormStatus }>): Record<ListFilter, number> {
  const counts: Record<ListFilter, number> = { all: rows.length, published: 0, draft: 0, paused: 0, archived: 0 };
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

// ── Buscar, filtrar y resumir (plano formularios-ui, F5) ───────────────────────

export interface ListQuery {
  /** La busqueda tal cual la escribio la persona (recortada). */
  q: string;
  status: ListFilter;
  type: TypeFilter;
}

type ParamValue = string | string[] | null | undefined;
const one = (value: ParamValue): string | undefined => (Array.isArray(value) ? value[0] : (value ?? undefined));

/** Lo que dice la URL (`?q=&estado=&tipo=`). Un valor invalido se ignora (queda el de por defecto). */
export function parseListQuery(params: { q?: ParamValue; estado?: ParamValue; tipo?: ParamValue }): ListQuery {
  return {
    q: (one(params.q) ?? "").trim().slice(0, 120),
    status: parseListFilter(one(params.estado)),
    type: parseTypeFilter(one(params.tipo)),
  };
}

/** La URL de un filtro: solo lo que se aparta del valor por defecto (la lista sin filtros es `/formularios` a secas). */
export function listQueryString(query: ListQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim() !== "") params.set("q", query.q.trim());
  if (query.status !== "all") params.set("estado", query.status);
  if (query.type !== "all") params.set("tipo", query.type);
  return params.toString();
}

export const hasActiveFilters = (query: ListQuery): boolean => query.q.trim() !== "" || query.status !== "all" || query.type !== "all";

/** Sin mayusculas, sin tildes y con los espacios juntos: "Aplicación  al Programa" ~ "aplicacion al programa". */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type Filterable = { name: string; publicTitle?: string | null; type: FormType; status: FormStatus };

/**
 * Los formularios que pasan los tres filtros. La busqueda mira el nombre interno y el titulo publico. Los
 * archivados van al final; dentro de cada grupo se conserva el orden que traian.
 */
export function filterForms<T extends Filterable>(rows: T[], query: ListQuery): T[] {
  const needle = normalizeSearch(query.q);
  const passing = rows.filter((row) => {
    if (query.status !== "all" && row.status !== query.status) return false;
    if (!matchesType(row, query.type)) return false;
    if (needle === "") return true;
    return normalizeSearch(`${row.name} ${row.publicTitle ?? ""}`).includes(needle);
  });
  return [...passing.filter((r) => r.status !== "archived"), ...passing.filter((r) => r.status === "archived")];
}

/** Cuantos formularios hay de cada estado y de cada tipo (sobre toda la lista, sin aplicar filtros). */
export function countsFor(rows: Array<{ status: FormStatus; type: FormType }>): {
  status: Record<ListFilter, number>;
  type: Record<TypeFilter, number>;
} {
  const type: Record<TypeFilter, number> = { all: rows.length, custom: 0, survey: 0, contract: 0, eod: 0 };
  for (const row of rows) type[row.type] += 1;
  return { status: countByStatus(rows), type };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const STATUS_LABEL: Record<ListFilter, string> = { all: "Todos", published: "Publicados", draft: "Borradores", paused: "Pausados", archived: "Archivados" };

export interface ListSummary {
  /** Sin filtros: "8 formularios · 4 publicados · 582 respuestas en total". Con filtros: "3 de 8 formularios". */
  text: string;
  /** Un chip (con su ×) por cada filtro activo. Vacio sin filtros. */
  chips: Array<{ id: "estado" | "tipo" | "q"; label: string }>;
  filtered: boolean;
}

/** La linea de resumen de debajo de la barra. Los envios no cuentan los de formularios archivados. */
export function listSummary(rows: Array<{ status: FormStatus; submissions: number }>, shown: number, query: ListQuery): ListSummary {
  if (!hasActiveFilters(query)) {
    const published = rows.filter((r) => r.status === "published").length;
    const responses = rows.filter((r) => r.status !== "archived").reduce((total, r) => total + r.submissions, 0);
    return {
      text: [
        plural(rows.length, "formulario", "formularios"),
        plural(published, "publicado", "publicados"),
        `${responses.toLocaleString("es-AR")} ${responses === 1 ? "respuesta" : "respuestas"} en total`,
      ].join(" · "),
      chips: [],
      filtered: false,
    };
  }
  const chips: ListSummary["chips"] = [];
  if (query.status !== "all") chips.push({ id: "estado", label: `Estado: ${STATUS_LABEL[query.status]}` });
  if (query.type !== "all") chips.push({ id: "tipo", label: `Tipo: ${FORM_TYPE_LABELS[query.type]}` });
  if (query.q.trim() !== "") chips.push({ id: "q", label: `“${query.q.trim()}”` });
  return { text: `${shown} de ${plural(rows.length, "formulario", "formularios")}`, chips, filtered: true };
}
