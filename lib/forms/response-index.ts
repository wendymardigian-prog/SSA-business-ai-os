/**
 * Buscar, filtrar por país y por la campaña de la visita, y agrupar las respuestas de un formulario.
 *
 * Puro. Lo usan la página de Respuestas y el CSV, así los dos muestran lo mismo con los mismos filtros.
 *
 * Por qué en TypeScript y no en la consulta: el país sale del prefijo del teléfono, y el +1 lo
 * comparten Estados Unidos, Canadá, Dominicana y Puerto Rico (se decide por el código de área,
 * `countryFromPhone`). La consulta trae las respuestas que pasan los filtros de base (estado,
 * contacto y fecha; la RLS decide cuáles ve cada quien) y esto hace el resto.
 */
import { countryFromPhone, phoneCountryInfo } from "@/lib/phone-country";
import { foldText, type MultiFilterOption } from "@/lib/ui/multi-filter";
import { answerToText, type StoredAnswer } from "./responses";

export const RESPONSE_DIMENSIONS = ["pais", "fuente", "medio", "campana", "contenido"] as const;
export type ResponseDimension = (typeof RESPONSE_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<ResponseDimension, string> = {
  pais: "País",
  fuente: "Fuente",
  medio: "Medio",
  campana: "Campaña",
  contenido: "Contenido",
};

/** La clave de atribución de cada dimensión que no es el país. */
const ATTRIBUTION_KEY: Record<Exclude<ResponseDimension, "pais">, string> = {
  fuente: "utm_source",
  medio: "utm_medium",
  campana: "utm_campaign",
  contenido: "utm_content",
};

/** El grupo de lo que no tiene dato. Se puede filtrar por él como por cualquier otro. */
export const NO_VALUE = "__none";

/** Lo que cada respuesta necesita para esto: sus respuestas y su atribución ya aplanada (`flatAttribution`). */
export interface IndexRow {
  answers: Record<string, StoredAnswer>;
  attribution: Record<string, string>;
}

export type DimensionFilters = Partial<Record<ResponseDimension, string[]>>;

export interface DerivedFilters {
  /** Lo buscado, tal como lo escribió la persona. */
  q: string;
  dims: DimensionFilters;
}

/** La pregunta de teléfono de la que sale el país: la primera de tipo `phone`. Sin ninguna, no hay país. */
export function phoneFieldKey(fields: ReadonlyArray<{ key: string; type: string }>): string | null {
  return fields.find((f) => f.type === "phone")?.key ?? null;
}

/** Las dimensiones que tienen sentido para este formulario: sin pregunta de teléfono, no hay país. */
export function availableDimensions(phoneKey: string | null): ResponseDimension[] {
  return RESPONSE_DIMENSIONS.filter((d) => d !== "pais" || phoneKey !== null);
}

export function phoneOf(row: IndexRow, phoneKey: string | null): string {
  return phoneKey ? answerToText(row.answers?.[phoneKey]?.value) : "";
}

/** El valor de una respuesta en una dimensión: el código del país o el texto de la UTM; `NO_VALUE` si no hay. */
export function dimensionValue(row: IndexRow, dimension: ResponseDimension, phoneKey: string | null): string {
  if (dimension === "pais") return countryFromPhone(phoneOf(row, phoneKey))?.code ?? NO_VALUE;
  const raw = row.attribution?.[ATTRIBUTION_KEY[dimension]];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value || NO_VALUE;
}

/** Cómo se ve un valor: «🇵🇪 Perú», la UTM tal cual, o «Sin país» / «Sin dato». */
export function dimensionValueLabel(dimension: ResponseDimension, value: string): string {
  if (value === NO_VALUE) return dimension === "pais" ? "Sin país" : "Sin dato";
  if (dimension === "pais") {
    const info = phoneCountryInfo(value);
    return info.flag ? `${info.flag} ${info.name}` : info.name;
  }
  return value;
}

/**
 * Lo buscado aparece en alguna respuesta, en el teléfono (también escrito con espacios o guiones) o
 * en la campaña de la visita. Sin acentos ni mayúsculas.
 */
export function matchesSearch(row: IndexRow, q: string): boolean {
  const needle = foldText(q.trim());
  if (!needle) return true;
  const digits = q.replace(/\D/g, "");
  const looksLikePhone = digits.length >= 4 && /^[\d\s()+.-]+$/.test(q.trim());

  for (const answer of Object.values(row.answers ?? {})) {
    const text = answerToText(answer?.value);
    if (!text) continue;
    if (foldText(text).includes(needle)) return true;
    if (looksLikePhone && text.replace(/\D/g, "").includes(digits)) return true;
  }
  return Object.values(row.attribution ?? {}).some((v) => typeof v === "string" && foldText(v).includes(needle));
}

/** Las respuestas que pasan la búsqueda y los filtros por dimensión (entre valores de la misma, cualquiera). */
export function filterIndex<R extends IndexRow>(rows: readonly R[], filters: DerivedFilters, phoneKey: string | null): R[] {
  const active = availableDimensions(phoneKey).filter((d) => (filters.dims[d]?.length ?? 0) > 0);
  if (!filters.q.trim() && active.length === 0) return [...rows];
  return rows.filter(
    (row) =>
      active.every((d) => filters.dims[d]!.includes(dimensionValue(row, d, phoneKey))) && matchesSearch(row, filters.q),
  );
}

export interface GroupCount {
  value: string;
  label: string;
  count: number;
  /** Porcentaje del total, redondeado a un decimal. */
  pct: number;
}

/**
 * Cuántas respuestas hay de cada valor. De la más grande a la más chica, «Sin dato» al final.
 * Cada respuesta cae en UN grupo: la suma de los grupos es el total.
 */
export function groupCounts(rows: readonly IndexRow[], dimension: ResponseDimension, phoneKey: string | null): GroupCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = dimensionValue(row, dimension, phoneKey);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const total = rows.length;
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: dimensionValueLabel(dimension, value),
      count,
      pct: total ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => {
      if (a.value === NO_VALUE) return 1;
      if (b.value === NO_VALUE) return -1;
      return b.count - a.count || a.label.localeCompare(b.label, "es");
    });
}

/** Las opciones de un filtro: los valores que existen, con cuántas respuestas tiene cada uno. */
export function facetOptions(rows: readonly IndexRow[], dimension: ResponseDimension, phoneKey: string | null): MultiFilterOption[] {
  return groupCounts(rows, dimension, phoneKey).map((g) => ({ value: g.value, label: `${g.label} (${g.count})` }));
}
