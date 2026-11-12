/**
 * Las columnas de atribución de una tabla (por ejemplo, las agendas) y qué elige ver cada persona. Puro:
 * las pantallas solo lo componen.
 *
 * Lo elegido se guarda como DIFERENCIA con lo normal, no como lista de lo visible: así una columna nueva, como una
 * pregunta nueva de un formulario, aparece sola sin que nadie tenga que prenderla.
 */
import { bestEntryUrl, ATTRIBUTION_LABELS } from "./attribution-view";
import { AD_KEYS, CLICK_ID_KEYS, COOKIE_VALUE_KEYS } from "./keys";
import { lastClickLine, type BookingTouchView } from "./last-touches";
import type { MetaRowNames } from "./meta-names";

export interface ColumnGroup {
  key: string;
  label: string;
}

export const ATTRIBUTION_COLUMN_GROUPS: readonly ColumnGroup[] = [
  { key: "campaign", label: "Campaña" },
  { key: "meta", label: "Anuncio de Meta" },
  { key: "pages", label: "Páginas" },
  { key: "clicks", label: "Clics y navegador" },
];

/** La columna «Último click» de la Agenda: el toque más reciente del contacto antes de agendar, de cualquier canal. */
export const LAST_CLICK_COLUMN_KEY = "touch:last";

/** Los grupos del menú «Columnas» de la Agenda: «Último click» primero. */
export const AGENDA_COLUMN_GROUPS: readonly ColumnGroup[] = [{ key: "lastclick", label: "Último click" }, ...ATTRIBUTION_COLUMN_GROUPS];

export interface AttributionCellSource {
  attribution: Record<string, string>;
  /** Los últimos toques antes de agendar (el primero es el «último click»). Solo la Agenda los trae. */
  lastClick?: readonly BookingTouchView[];
  metaNames: MetaRowNames;
  /** «Vinculado», «A mano», «Sin vincular», «Ignorado». Vacío si no hay nada que decir. */
  metaStatus?: string;
}

export interface ColumnDef<Row> {
  key: string;
  label: string;
  group: string;
  defaultVisible: boolean;
  /** Se ve con su texto completo al pasar el mouse y un botón para copiar. */
  copyable?: boolean;
  /** Aclaración del título de la columna. */
  hint?: string;
  /** Un campo que ya no está en la versión vigente del formulario. */
  removed?: boolean;
  /** El valor es un link (un campo Link de un formulario): se abre en una pestaña nueva. */
  link?: boolean;
  value: (row: Row) => string;
}

const REFERRER_HINT = "Los navegadores y las apps solo dejan ver el dominio de la página anterior, no la dirección completa.";

/** El catálogo, en el orden de la tabla. `defaults` dice cuáles se ven de entrada. */
export function attributionColumnDefs(defaults: ReadonlySet<string>, options: { lastClick?: boolean } = {}): ColumnDef<AttributionCellSource>[] {
  const column = (key: string, group: string, label?: string, hint?: string): ColumnDef<AttributionCellSource> => ({
    key: `attr:${key}`,
    label: label ?? ATTRIBUTION_LABELS[key] ?? key,
    group,
    defaultVisible: defaults.has(`attr:${key}`),
    hint,
    value: (row) => row.attribution[key] ?? "",
  });
  const metaName = (key: "campaign" | "adset" | "ad", label: string): ColumnDef<AttributionCellSource> => ({
    key: `meta:${key}`,
    label,
    group: "meta",
    defaultVisible: defaults.has(`meta:${key}`),
    value: (row) => row.metaNames[key] ?? "",
  });
  const lastClick: ColumnDef<AttributionCellSource>[] = options.lastClick
    ? [
        {
          key: LAST_CLICK_COLUMN_KEY,
          label: "Último click",
          group: "lastclick",
          defaultVisible: defaults.has(LAST_CLICK_COLUMN_KEY),
          hint: "El último toque del contacto antes de agendar (pauta u orgánico). Pasá el mouse para ver los últimos 3.",
          value: (row) => lastClickLine(row.lastClick),
        },
      ]
    : [];
  return [
    ...lastClick,
    column("utm_source", "campaign"),
    column("utm_medium", "campaign"),
    column("utm_campaign", "campaign"),
    column("utm_content", "campaign"),
    column("utm_term", "campaign"),
    column("utm_id", "campaign"),
    metaName("campaign", "Campaña de Meta"),
    metaName("adset", "Conjunto de Meta"),
    metaName("ad", "Anuncio de Meta"),
    { key: "meta:status", label: "Vínculo con Meta", group: "meta", defaultVisible: defaults.has("meta:status"), value: (row) => row.metaStatus ?? "" },
    column("ad_id", "meta"),
    ...AD_KEYS.filter((key) => key !== "ad_id").map((key) => column(key, "meta")),
    column("referrer_url", "pages", undefined, REFERRER_HINT),
    {
      key: "entry_url",
      label: "URL de entrada",
      group: "pages",
      defaultVisible: defaults.has("entry_url"),
      copyable: true,
      value: (row) => bestEntryUrl(row.attribution) ?? "",
    },
    column("landing_page", "pages"),
    column("page_url", "pages"),
    ...[...CLICK_ID_KEYS, ...COOKIE_VALUE_KEYS].map((key) => column(key, "clicks")),
  ];
}

/** La atribución tal como viaja a una tabla: solo texto, sin `first_visit`. */
export function flatAttribution(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
}

/** La línea de una tarjeta en el celular: «meta / paid · clase-9-nov». Vacía si no hay datos. */
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

export function visibleColumns<Row>(defs: readonly ColumnDef<Row>[], prefs: ResponseColumnPrefs): ColumnDef<Row>[] {
  const hidden = new Set(prefs.hidden);
  const shown = new Set(prefs.shown);
  return defs.filter((def) => (def.defaultVisible ? !hidden.has(def.key) : shown.has(def.key)));
}

export function toggleColumn(prefs: ResponseColumnPrefs, def: { key: string; defaultVisible: boolean }): ResponseColumnPrefs {
  const list = def.defaultVisible ? "hidden" : "shown";
  const has = prefs[list].includes(def.key);
  return { ...prefs, [list]: has ? prefs[list].filter((key) => key !== def.key) : [...prefs[list], def.key] };
}

export function showAllColumns<Row>(defs: readonly ColumnDef<Row>[]): ResponseColumnPrefs {
  return { hidden: [], shown: defs.filter((def) => !def.defaultVisible).map((def) => def.key) };
}

/** Las columnas del menú, por grupo, filtradas por lo que se escribió en el buscador. */
export function columnMenuGroups<Row>(defs: readonly ColumnDef<Row>[], query: string, groups: readonly ColumnGroup[]) {
  const needle = query.trim().toLocaleLowerCase("es");
  return groups
    .map((group) => ({
      ...group,
      columns: defs.filter((def) => def.group === group.key && (!needle || def.label.toLocaleLowerCase("es").includes(needle))),
    }))
    .filter((group) => group.columns.length > 0);
}
