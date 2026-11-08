/**
 * Las columnas de la tabla de respuestas: las preguntas del formulario y la atribución de la visita, y qué elige ver
 * cada persona. La pantalla solo compone esto. Puro.
 *
 * Lo elegido se guarda como DIFERENCIA con lo normal, no como lista de lo visible: así una pregunta nueva del
 * formulario aparece sola, sin que nadie tenga que prenderla.
 */
import {
  ATTRIBUTION_COLUMN_GROUPS,
  attributionColumnDefs,
  columnMenuGroups as menuGroups,
  type AttributionCellSource,
  type ColumnDef,
  type ColumnGroup,
} from "@/lib/attribution/columns";
import { cellFor, type ResponseColumn, type StoredAnswer } from "./responses";
import { countryFromPhone } from "@/lib/phone-country";
import { phoneFieldKey } from "./response-index";

export {
  EMPTY_COLUMN_PREFS,
  flatAttribution,
  originSummary,
  parseColumnPrefs,
  serializeColumnPrefs,
  showAllColumns,
  toggleColumn,
  visibleColumns,
  type ResponseColumnPrefs,
} from "@/lib/attribution/columns";

export const RESPONSE_COLUMN_GROUPS: readonly ColumnGroup[] = [{ key: "answers", label: "Respuestas" }, ...ATTRIBUTION_COLUMN_GROUPS];

/** Lo que cada fila necesita para llenar sus columnas. */
export interface ResponseCellSource extends AttributionCellSource {
  answers: Record<string, StoredAnswer>;
}

export type ResponseColumnDef = ColumnDef<ResponseCellSource>;

/** Lo que se ve al abrir la tabla de respuestas. */
const DEFAULT_ATTRIBUTION_COLUMNS: ReadonlySet<string> = new Set([
  "attr:utm_source",
  "attr:utm_medium",
  "attr:utm_campaign",
  "attr:utm_content",
  "attr:utm_term",
  "meta:campaign",
  "meta:adset",
  "meta:ad",
  "meta:status",
  "attr:ad_id",
  "attr:referrer_url",
  "entry_url",
]);

/** «🇵🇪 Perú», sacado del prefijo del teléfono; vacío si no tiene uno internacional. */
export function countryCell(phone: string): string {
  const country = countryFromPhone(phone);
  return country ? `${country.flag} ${country.name}`.trim() : "";
}

/**
 * Las preguntas primero, en su orden, y la atribución al final. Justo después de la pregunta de
 * teléfono (la primera), «País», que sale de su prefijo.
 */
export function responseColumnDefs(answers: readonly ResponseColumn[]): ResponseColumnDef[] {
  const phoneKey = phoneFieldKey(answers);
  const answerDefs = answers.flatMap((column): ResponseColumnDef[] => {
    const def: ResponseColumnDef = {
      key: `answer:${column.key}`,
      label: column.label,
      group: "answers",
      defaultVisible: true,
      removed: column.removed,
      hint: column.removed ? "Este campo ya no está en el formulario" : undefined,
      value: (row) => cellFor(row, column),
    };
    if (column.key !== phoneKey) return [def];
    const country: ResponseColumnDef = {
      key: `country:${column.key}`,
      label: "País",
      group: "answers",
      defaultVisible: true,
      hint: `Sale del prefijo de «${column.label}»`,
      value: (row) => countryCell(cellFor(row, column)),
    };
    return [def, country];
  });
  return [...answerDefs, ...attributionColumnDefs(DEFAULT_ATTRIBUTION_COLUMNS)];
}

export const responseColumnsStorageKey = (formId: string) => `form-responses-columns:${formId}`;

/** Las columnas del menú, por grupo, filtradas por lo que se escribió en el buscador. */
export function columnMenuGroups(defs: readonly ResponseColumnDef[], query: string) {
  return menuGroups(defs, query, RESPONSE_COLUMN_GROUPS);
}
