/**
 * El catálogo de filtros de la lista de contactos: UNA lista con cada filtro,
 * su parámetro de la URL, su grupo, su tipo y la parte de la consulta que arma.
 *
 * De acá salen el panel de filtros (con su buscador), los chips de filtros
 * activos, "Limpiar filtros", el contador y la consulta (`../list-query.ts`).
 * Los de cada área (Agenda, Secuencias…) viven en `../related/*` y se suman en
 * `../list-modules.ts`.
 *
 * Puro: no importa nada de `next/*` ni de Supabase.
 */
import { LEAD_TEMPERATURES, LEAD_TEMPERATURE_LABELS } from "../fields";
import { MEDIUMS, MEDIUM_LABELS, SOURCES, SOURCE_LABELS } from "../taxonomy";
import { STATUS_KEY_RE, parseLastStatusParam } from "../statuses";
import { UNQUALIFIED_LABEL } from "../qualification";
import { EMAIL_STATUSES, EMAIL_STATUS_LABELS } from "@/lib/email/subscription";
import { isSupportedPlatform } from "@/lib/platforms";
import { foldText } from "@/lib/ui/multi-filter";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import { COUNTRY_OPTIONS } from "./options";
import { PAST_PRESETS, describeDateValue, dateBounds, parseDateValue, type DatePreset } from "./dates";
import {
  NONE,
  UUID_RE,
  boundsClauses,
  isYesNo,
  noneOrIn,
  type ContactFilterDef,
  type FilterOptions,
  type FilterPlanPart,
  type ListClause,
  type ListGroupDef,
  type PlanContext,
} from "./types";

// ---------------------------------------------------------------------------
// Grupos (los compartidos; cada área declara el suyo)
// ---------------------------------------------------------------------------

export const GROUPS = {
  assignment: { key: "asignacion", label: "Asignación", order: 10 },
  pipeline: { key: "pipeline", label: "Pipeline", order: 20 },
  data: { key: "datos", label: "Datos", order: 30 },
  marks: { key: "marcas", label: "Marcas", order: 35 },
  email: { key: "email", label: "Email", order: 40 },
  tags: { key: "etiquetas", label: "Etiquetas", order: 45 },
  channels: { key: "canales", label: "Canales", order: 50 },
  firstTouch: { key: "primer_toque", label: "Atribución · primer toque", order: 60 },
  lastTouch: { key: "ultimo_toque", label: "Atribución · último toque", order: 61 },
  custom: { key: "campos", label: "Campos personalizados", order: 99 },
} as const satisfies Record<string, ListGroupDef>;

// ---------------------------------------------------------------------------
// Constructores
// ---------------------------------------------------------------------------

const isId = (v: string) => UUID_RE.test(v);
const idOrNone = (v: string) => v === NONE || UUID_RE.test(v);
const statusOrNone = (v: string) => v === NONE || STATUS_KEY_RE.test(v);
const inList = (list: readonly string[]) => (v: string) => list.includes(v);
const isCountry = (v: string) => v === NONE || /^[A-Z]{2}$/.test(v);

/** Un filtro de varias opciones sobre una columna de `contacts`. */
export function multiColumnFilter(o: {
  param: string;
  label: string;
  group: ListGroupDef;
  column: string;
  accepts: (v: string) => boolean;
  options: FilterOptions;
  keywords?: string;
  hint?: string;
  chipLabel?: string;
}): ContactFilterDef {
  return {
    param: o.param,
    label: o.label,
    chipLabel: o.chipLabel,
    group: o.group,
    kind: "multi",
    accepts: o.accepts,
    options: o.options,
    keywords: o.keywords,
    hint: o.hint,
    plan: (values) => ({ clauses: [noneOrIn(o.column, values)].filter((c): c is ListClause => c !== null) }),
  };
}

/** Sí / No sobre una columna booleana de `contacts`. */
export function yesNoColumnFilter(o: { param: string; label: string; group: ListGroupDef; column: string; keywords?: string; hint?: string }): ContactFilterDef {
  return {
    param: o.param,
    label: o.label,
    group: o.group,
    kind: "yesno",
    accepts: isYesNo,
    keywords: o.keywords,
    hint: o.hint,
    plan: (values) => ({ clauses: [{ op: "eq", column: o.column, value: values[0] === "si" }] }),
  };
}

/** Una fecha de `contacts` (atajos y rango). */
export function dateColumnFilter(o: {
  param: string;
  label: string;
  group: ListGroupDef;
  column: string;
  presets: readonly DatePreset[];
  keywords?: string;
}): ContactFilterDef {
  return {
    param: o.param,
    label: o.label,
    group: o.group,
    kind: "date",
    datePresets: o.presets,
    dateRange: true,
    keywords: o.keywords,
    accepts: (v) => parseDateValue(v, o.presets) !== null,
    plan: (values, ctx) => {
      const parsed = parseDateValue(values[0], o.presets);
      return parsed ? { clauses: boundsClauses(o.column, dateBounds(parsed, ctx.now, ctx.timeZone)) } : {};
    },
  };
}

/** Sí / No por "tiene al menos una fila" en otra tabla, con sus condiciones. */
export function hasRelatedFilter(o: {
  param: string;
  label: string;
  group: ListGroupDef;
  relation: string;
  columns: readonly string[];
  clauses?: readonly ListClause[];
  keywords?: string;
  hint?: string;
}): ContactFilterDef {
  return {
    param: o.param,
    label: o.label,
    group: o.group,
    kind: "yesno",
    related: true,
    accepts: isYesNo,
    keywords: o.keywords,
    hint: o.hint,
    plan: (values) => ({
      related: [{ relation: o.relation, mode: values[0] === "si" ? "has" : "none", columns: o.columns, clauses: o.clauses ?? [] }],
    }),
  };
}

/** Varias opciones sobre una columna de otra tabla: "tiene alguna fila con alguno de estos valores". */
export function relatedMultiFilter(o: {
  param: string;
  label: string;
  group: ListGroupDef;
  relation: string;
  column: string;
  accepts: (v: string) => boolean;
  options: FilterOptions;
  /** Condiciones que siempre van (sin borrados, sin spam…). */
  base?: readonly ListClause[];
  baseColumns?: readonly string[];
  keywords?: string;
  hint?: string;
  chipLabel?: string;
  /** "no tiene ninguna fila con estos valores" en vez de "tiene alguna". */
  negate?: boolean;
}): ContactFilterDef {
  return {
    param: o.param,
    label: o.label,
    chipLabel: o.chipLabel,
    group: o.group,
    kind: "multi",
    related: true,
    accepts: o.accepts,
    options: o.options,
    keywords: o.keywords,
    hint: o.hint,
    plan: (values) => ({
      related: [
        {
          relation: o.relation,
          mode: o.negate ? "none" : "has",
          columns: [o.column, ...(o.baseColumns ?? [])],
          clauses: [...(o.base ?? []), { op: "in", column: o.column, values: [...values] }],
        },
      ],
    }),
  };
}

/** Una fecha de otra tabla: "tiene alguna fila en este rango". */
export function relatedDateFilter(o: {
  param: string;
  label: string;
  group: ListGroupDef;
  relation: string;
  column: string;
  presets: readonly DatePreset[];
  base?: readonly ListClause[];
  baseColumns?: readonly string[];
  keywords?: string;
}): ContactFilterDef {
  return {
    param: o.param,
    label: o.label,
    group: o.group,
    kind: "date",
    related: true,
    datePresets: o.presets,
    dateRange: true,
    keywords: o.keywords,
    accepts: (v) => parseDateValue(v, o.presets) !== null,
    plan: (values, ctx) => {
      const parsed = parseDateValue(values[0], o.presets);
      if (!parsed) return {};
      return {
        related: [
          {
            relation: o.relation,
            mode: "has",
            columns: [o.column, ...(o.baseColumns ?? [])],
            clauses: [...(o.base ?? []), ...boundsClauses(o.column, dateBounds(parsed, ctx.now, ctx.timeZone))],
          },
        ],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Las rutas de la atribución (las mismas de los índices de la 00114)
// ---------------------------------------------------------------------------

export const FIRST_TOUCH_SOURCE_PATH = "attribution->first_touch->>source";
export const FIRST_TOUCH_MEDIUM_PATH = "attribution->first_touch->>medium";

// ---------------------------------------------------------------------------
// Los filtros de la tabla `contacts`
// ---------------------------------------------------------------------------

/** "" oculta los anónimos (default), "1" los suma, "solo" muestra solo esos. */
export const ANON_FILTER_VALUES = ["", "1", "solo"] as const;
export type AnonFilter = (typeof ANON_FILTER_VALUES)[number];

export const CORE_FILTERS: readonly ContactFilterDef[] = [
  // Asignación
  multiColumnFilter({
    param: "setter",
    label: "Setter",
    group: GROUPS.assignment,
    column: "setter_id",
    accepts: idOrNone,
    options: { from: "members", none: "Sin asignar" },
  }),
  multiColumnFilter({
    param: "vendedor",
    label: "Vendedor",
    group: GROUPS.assignment,
    column: "vendedor_id",
    accepts: idOrNone,
    options: { from: "members", none: "Sin asignar" },
    keywords: "closer",
  }),
  multiColumnFilter({
    param: "referido",
    label: "Referido por",
    group: GROUPS.assignment,
    column: "referred_by_user_id",
    accepts: idOrNone,
    options: { from: "members", none: "Sin referido" },
    keywords: "referencia",
  }),

  // Pipeline (00245/00246)
  {
    param: "estado",
    label: "Último estado",
    group: GROUPS.pipeline,
    kind: "multi",
    options: { from: "lastStatuses" },
    accepts: (v) => parseLastStatusParam(v) !== null,
    plan: (values) => {
      const pairs = values.map(parseLastStatusParam).filter((p): p is NonNullable<typeof p> => p !== null);
      if (pairs.length === 1) {
        return {
          clauses: [
            { op: "eq", column: "last_status_role", value: pairs[0].role },
            { op: "eq", column: "last_status", value: pairs[0].key },
          ],
        };
      }
      return { clauses: [{ op: "or", filter: pairs.map((s) => `and(last_status_role.eq.${s.role},last_status.eq.${s.key})`).join(",") }] };
    },
  },
  multiColumnFilter({
    param: "estado_setter",
    label: "Estado de setter",
    group: GROUPS.pipeline,
    column: "setter_status",
    accepts: statusOrNone,
    options: { from: "setterStatuses", none: "Sin estado" },
  }),
  multiColumnFilter({
    param: "estado_vendedor",
    label: "Estado de vendedor",
    group: GROUPS.pipeline,
    column: "closer_status",
    accepts: statusOrNone,
    options: { from: "closerStatuses", none: "Sin estado" },
    keywords: "closer",
  }),
  multiColumnFilter({
    param: "calif",
    label: "Calificación",
    group: GROUPS.pipeline,
    column: "qualification_level",
    accepts: (v) => v === NONE || /^[1-5]$/.test(v),
    options: { from: "qualificationLevels", none: UNQUALIFIED_LABEL },
    keywords: "nivel puntaje score",
  }),
  multiColumnFilter({
    param: "producto",
    label: "Producto de interés",
    group: GROUPS.pipeline,
    column: "interest_product_id",
    accepts: idOrNone,
    options: { from: "products", none: "Sin producto" },
  }),

  // Datos
  multiColumnFilter({
    param: "temp",
    label: "Temperatura",
    group: GROUPS.data,
    column: "lead_temperature",
    accepts: inList(LEAD_TEMPERATURES),
    options: { static: LEAD_TEMPERATURES.map((t) => ({ value: t, label: LEAD_TEMPERATURE_LABELS[t] })) },
  }),
  multiColumnFilter({
    param: "pais",
    label: "País",
    group: GROUPS.data,
    column: "country",
    accepts: isCountry,
    options: { static: COUNTRY_OPTIONS, none: "Sin país" },
  }),
  dateColumnFilter({ param: "creado", label: "Creado", group: GROUPS.data, column: "created_at", presets: PAST_PRESETS, keywords: "alta fecha nuevo" }),
  dateColumnFilter({
    param: "ultima",
    label: "Última interacción",
    group: GROUPS.data,
    column: "last_interaction_at",
    presets: [...PAST_PRESETS, "sin"],
    keywords: "fecha mensaje actividad",
  }),
  dateColumnFilter({
    param: "seguimiento",
    label: "Próximo seguimiento",
    group: GROUPS.data,
    column: "next_followup_date",
    presets: ["vencido", "hoy", "proximos7", "con", "sin"],
    keywords: "fecha followup",
  }),
  {
    param: "anon",
    label: "Contactos sin datos",
    group: GROUPS.data,
    kind: "choice",
    defaultLabel: "Ocultos",
    options: {
      static: [
        { value: "1", label: "Incluidos" },
        { value: "solo", label: "Solo esos" },
      ],
    },
    keywords: "anonimos",
    hint: "Los que todavía no dejaron nombre, email ni teléfono.",
    accepts: (v) => v === "1" || v === "solo",
    // La condición la pone siempre `contactListPlan` (también sin el parámetro).
    plan: () => ({}),
  },

  // Marcas
  yesNoColumnFilter({ param: "cliente", label: "Cliente", group: GROUPS.marks, column: "is_customer", keywords: "compro" }),
  yesNoColumnFilter({ param: "conocido", label: "Conocido", group: GROUPS.marks, column: "is_known" }),
  yesNoColumnFilter({ param: "no_contactar", label: "No contactar", group: GROUPS.marks, column: "do_not_contact", keywords: "baja" }),

  // Email
  multiColumnFilter({
    param: "email",
    label: "Estado de email",
    group: GROUPS.email,
    column: "email_status",
    accepts: inList(EMAIL_STATUSES),
    options: { static: EMAIL_STATUSES.map((st) => ({ value: st, label: EMAIL_STATUS_LABELS[st] })) },
    keywords: "suscripcion baja rebota",
  }),

  // Etiquetas: tiene alguna de estas. El join con alias no toca el `contact_tags`
  // que trae todas las etiquetas de cada contacto.
  {
    param: "tag",
    label: "Etiqueta",
    group: GROUPS.tags,
    kind: "multi",
    options: { from: "tags" },
    keywords: "tag",
    accepts: isId,
    plan: (values) => ({
      embeds: ["tag_match:contact_tags!inner(tag_id)"],
      clauses: [{ op: "in", column: "tag_match.tag_id", values: [...values] }],
    }),
  },

  // Canales: tiene una conversación por alguno de estos.
  {
    param: "canal",
    label: "Canal",
    group: GROUPS.channels,
    kind: "multi",
    options: { from: "platforms" },
    keywords: "instagram whatsapp email",
    accepts: isSupportedPlatform,
    plan: (values) => ({
      embeds: ["channel_match:contact_channels!inner(channels!inner(platform))"],
      clauses: [{ op: "in", column: "channel_match.channels.platform", values: [...values] }],
    }),
  },

  // Atribución: el PRIMER toque (F88), y el nombre lo dice: "entraron por un
  // comentario" no es "alguna vez comentaron".
  multiColumnFilter({
    param: "fuente",
    label: "Fuente",
    chipLabel: "Fuente (1.er toque)",
    group: GROUPS.firstTouch,
    column: FIRST_TOUCH_SOURCE_PATH,
    accepts: inList(SOURCES),
    options: { static: SOURCES.map((src) => ({ value: src, label: SOURCE_LABELS[src] })) },
    keywords: "origen utm_source",
  }),
  multiColumnFilter({
    param: "medio",
    label: "Medio",
    chipLabel: "Medio (1.er toque)",
    group: GROUPS.firstTouch,
    column: FIRST_TOUCH_MEDIUM_PATH,
    accepts: inList(MEDIUMS),
    options: { static: MEDIUMS.map((m) => ({ value: m, label: MEDIUM_LABELS[m] })) },
    keywords: "utm_medium",
  }),
];

// ---------------------------------------------------------------------------
// Lecturas del catálogo
// ---------------------------------------------------------------------------

/** El filtro por campo personalizado: tres parámetros que van juntos. */
export const CUSTOM_FILTER_PARAMS = ["campo", "op", "valor"] as const;

/** Los grupos que aparecen, en orden. */
export function filterGroups(defs: readonly ContactFilterDef[]): ListGroupDef[] {
  const seen = new Map<string, ListGroupDef>();
  for (const d of defs) if (!seen.has(d.group.key)) seen.set(d.group.key, d.group);
  return [...seen.values()].sort((a, b) => a.order - b.order);
}

/** ¿El filtro coincide con lo escrito en el buscador? Por su nombre, su grupo y sus palabras extra. */
export function filterMatches(def: Pick<ContactFilterDef, "label" | "group" | "keywords">, query: string): boolean {
  const q = foldText(query.trim());
  if (!q) return true;
  const haystack = foldText([def.label, def.group.label, def.keywords ?? ""].join(" "));
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/** Lo que dibuja el panel: los grupos con sus filtros, filtrados por el buscador. Los vacíos no salen. */
export function filterPanelGroups<T extends Pick<ContactFilterDef, "label" | "group" | "keywords">>(
  defs: readonly T[],
  query: string,
): Array<{ group: ListGroupDef; filters: T[] }> {
  const out = new Map<string, { group: ListGroupDef; filters: T[] }>();
  for (const d of defs) {
    if (!filterMatches(d, query)) continue;
    const entry = out.get(d.group.key) ?? { group: d.group, filters: [] };
    entry.filters.push(d);
    out.set(d.group.key, entry);
  }
  return [...out.values()].sort((a, b) => a.group.order - b.group.order);
}

/** Las opciones de un filtro, con "ninguno" arriba cuando corresponde. */
export function filterOptionList(def: Pick<ContactFilterDef, "options">, dynamic: Readonly<Record<string, readonly MultiFilterOption[]>>): MultiFilterOption[] {
  const o = def.options;
  if (!o) return [];
  const list = "static" in o ? o.static : (dynamic[o.from] ?? []);
  return o.none ? [{ value: NONE, label: o.none }, ...list] : [...list];
}

/** El texto de un valor elegido, para el chip. */
export function filterValueLabel(def: ContactFilterDef, value: string, dynamic: Readonly<Record<string, readonly MultiFilterOption[]>>): string {
  if (def.kind === "yesno") return value === "si" ? "Sí" : "No";
  if (def.kind === "date") return describeDateValue(value, def.datePresets ?? []);
  return filterOptionList(def, dynamic).find((o) => o.value === value)?.label ?? value;
}

/** El texto del chip de un filtro puesto: "Setter: Ana, Juan" o "Setter: 3 elegidos". */
export function filterChipText(def: ContactFilterDef, values: readonly string[], dynamic: Readonly<Record<string, readonly MultiFilterOption[]>>): string {
  const labels = values.map((v) => filterValueLabel(def, v, dynamic));
  const shown = labels.length <= 2 ? labels.join(", ") : `${labels.length} elegidos`;
  return `${def.chipLabel ?? def.label}: ${shown}`;
}

export type { PlanContext, FilterPlanPart };
