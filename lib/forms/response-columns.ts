/**
 * Las columnas de la tabla de respuestas: las preguntas del formulario y la atribución de la visita, y qué elige ver
 * cada persona. La pantalla solo compone esto. Puro.
 *
 * Lo elegido se guarda como DIFERENCIA con lo normal, no como lista de lo visible: así una pregunta nueva del
 * formulario aparece sola, sin que nadie tenga que prenderla.
 */
import { AD_KEYS, CLICK_ID_KEYS, COOKIE_VALUE_KEYS } from "@/lib/attribution/keys";
import { ATTRIBUTION_LABELS, bestEntryUrl } from "./attribution-view";
import type { MetaRowNames } from "./meta-names";
import { cellFor, type ResponseColumn, type StoredAnswer } from "./responses";

export type ResponseColumnGroup = "answers" | "campaign" | "meta" | "pages" | "clicks";

export const RESPONSE_COLUMN_GROUPS: ReadonlyArray<{ key: ResponseColumnGroup; label: string }> = [
  { key: "answers", label: "Respuestas" },
  { key: "campaign", label: "Campaña" },
  { key: "meta", label: "Anuncio de Meta" },
  { key: "pages", label: "Páginas" },
  { key: "clicks", label: "Clics y navegador" },
];

/** Lo que cada fila necesita para llenar sus columnas. */
export interface ResponseCellSource {
  answers: Record<string, StoredAnswer>;
  attribution: Record<string, string>;
  metaNames: MetaRowNames;
}

export interface ResponseColumnDef {
  key: string;
  label: string;
  group: ResponseColumnGroup;
  defaultVisible: boolean;
  /** Se ve con su texto completo al pasar el mouse y un botón para copiar. */
  copyable?: boolean;
  /** Aclaración del título de la columna. */
  hint?: string;
  /** El campo ya no está en la versión vigente del formulario. */
  removed?: boolean;
  value: (row: ResponseCellSource) => string;
}

const REFERRER_HINT = "Los navegadores y las apps solo dejan ver el dominio de la página anterior, no la dirección completa.";

function attributionColumn(key: string, group: ResponseColumnGroup, defaultVisible: boolean, label?: string, hint?: string): ResponseColumnDef {
  return {
    key: `attr:${key}`,
    label: label ?? ATTRIBUTION_LABELS[key] ?? key,
    group,
    defaultVisible,
    hint,
    value: (row) => row.attribution[key] ?? "",
  };
}

const ATTRIBUTION_COLUMNS: readonly ResponseColumnDef[] = [
  attributionColumn("utm_source", "campaign", true),
  attributionColumn("utm_medium", "campaign", true),
  attributionColumn("utm_campaign", "campaign", true),
  attributionColumn("utm_content", "campaign", true),
  attributionColumn("utm_term", "campaign", true),
  attributionColumn("utm_id", "campaign", false),
  { key: "meta:campaign", label: "Campaña de Meta", group: "meta", defaultVisible: true, value: (row) => row.metaNames.campaign ?? "" },
  { key: "meta:adset", label: "Conjunto de Meta", group: "meta", defaultVisible: true, value: (row) => row.metaNames.adset ?? "" },
  { key: "meta:ad", label: "Anuncio de Meta", group: "meta", defaultVisible: true, value: (row) => row.metaNames.ad ?? "" },
  attributionColumn("ad_id", "meta", true),
  ...AD_KEYS.filter((key) => key !== "ad_id").map((key) => attributionColumn(key, "meta", false)),
  attributionColumn("referrer_url", "pages", true, undefined, REFERRER_HINT),
  {
    key: "entry_url",
    label: "URL de entrada",
    group: "pages",
    defaultVisible: true,
    copyable: true,
    value: (row) => bestEntryUrl(row.attribution) ?? "",
  },
  attributionColumn("landing_page", "pages", false),
  attributionColumn("page_url", "pages", false),
  ...[...CLICK_ID_KEYS, ...COOKIE_VALUE_KEYS].map((key) => attributionColumn(key, "clicks", false)),
];

/** Las preguntas primero, en su orden, y la atribución al final. */
export function responseColumnDefs(answers: readonly ResponseColumn[]): ResponseColumnDef[] {
  const answerDefs = answers.map(
    (column): ResponseColumnDef => ({
      key: `answer:${column.key}`,
      label: column.label,
      group: "answers",
      defaultVisible: true,
      removed: column.removed,
      hint: column.removed ? "Este campo ya no está en el formulario" : undefined,
      value: (row) => cellFor(row, column),
    }),
  );
  return [...answerDefs, ...ATTRIBUTION_COLUMNS];
}

/** La atribución tal como viaja a la tabla: solo texto, sin `first_visit`. */
export function flatAttribution(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
}

/** La línea de la tarjeta en el celular: «meta / paid · clase-9-nov». Vacía si no hay datos. */
export function originSummary(attribution: Record<string, string>): string {
  const source = [attribution.utm_source, attribution.utm_medium].filter(Boolean).join(" / ");
  return [source, attribution.utm_campaign].filter(Boolean).join(" · ");
}

export interface ResponseColumnPrefs {
  /** Columnas normalmente visibles que la persona ocultó. */
  hidden: string[];
  /** Columnas normalmente ocultas que la persona prendió. */
  shown: string[];
}

export const EMPTY_COLUMN_PREFS: ResponseColumnPrefs = { hidden: [], shown: [] };

export const responseColumnsStorageKey = (formId: string) => `form-responses-columns:${formId}`;

const onlyText = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** Lee lo guardado. Nunca lanza: algo roto o vacío vuelve a las columnas normales. */
export function parseColumnPrefs(raw: string | null | undefined): ResponseColumnPrefs {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || (parsed as { v?: unknown }).v !== 1) return EMPTY_COLUMN_PREFS;
    const { hidden, shown } = parsed as { hidden?: unknown; shown?: unknown };
    return { hidden: onlyText(hidden), shown: onlyText(shown) };
  } catch {
    return EMPTY_COLUMN_PREFS;
  }
}

export function serializeColumnPrefs(prefs: ResponseColumnPrefs): string {
  return JSON.stringify({ v: 1, hidden: prefs.hidden, shown: prefs.shown });
}

export function visibleColumns(defs: readonly ResponseColumnDef[], prefs: ResponseColumnPrefs): ResponseColumnDef[] {
  const hidden = new Set(prefs.hidden);
  const shown = new Set(prefs.shown);
  return defs.filter((def) => (def.defaultVisible ? !hidden.has(def.key) : shown.has(def.key)));
}

export function toggleColumn(prefs: ResponseColumnPrefs, def: Pick<ResponseColumnDef, "key" | "defaultVisible">): ResponseColumnPrefs {
  const list = def.defaultVisible ? "hidden" : "shown";
  const has = prefs[list].includes(def.key);
  return { ...prefs, [list]: has ? prefs[list].filter((key) => key !== def.key) : [...prefs[list], def.key] };
}

export function showAllColumns(defs: readonly ResponseColumnDef[]): ResponseColumnPrefs {
  return { hidden: [], shown: defs.filter((def) => !def.defaultVisible).map((def) => def.key) };
}

/** Las columnas del menú, por grupo, filtradas por lo que se escribió en el buscador. */
export function columnMenuGroups(defs: readonly ResponseColumnDef[], query: string) {
  const needle = query.trim().toLocaleLowerCase("es");
  return RESPONSE_COLUMN_GROUPS.map((group) => ({
    ...group,
    columns: defs.filter((def) => def.group === group.key && (!needle || def.label.toLocaleLowerCase("es").includes(needle))),
  })).filter((group) => group.columns.length > 0);
}
