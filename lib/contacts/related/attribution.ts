/**
 * La lista de contactos: atribución del primer y del último toque.
 *
 * Filtra y muestra la copia derivada de `contacts.attribution` (la escribe
 * `record_contact_touch` desde `contact_touches`). Los filtros van sobre las
 * rutas jsonb de la forma canónica, las mismas de los índices de la 00114 y la
 * 00283; las columnas pasan por `readAttribution`, que entiende las tres formas
 * guardadas.
 *
 * Las opciones de campaña, contenido y término salen de
 * `contact_attribution_options` (00283, SECURITY INVOKER: cada persona ve los
 * valores de los contactos que ya puede ver). Sin esa función, esos filtros
 * quedan sin opciones y no se muestran: la lista sigue andando.
 */
import { readAttribution, type AttributionTouch } from "../attribution";
import { MEDIUMS, MEDIUM_LABELS, SOURCES, SOURCE_LABELS, mediumLabel, sourceLabel } from "../taxonomy";
import { GROUPS, multiColumnFilter } from "../filters/catalog";
import { isSafeText, type CellValue, type ContactColumnDef, type ContactFilterDef, type ContactListModule, type ContactRecord } from "../filters/types";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";

type Touch = "first" | "last";
const TOUCH_PATH: Record<Touch, string> = { first: "attribution->first_touch", last: "attribution->last_touch" };
const TOUCH_GROUP = { first: GROUPS.firstTouch, last: GROUPS.lastTouch } as const;
const TOUCH_SUFFIX: Record<Touch, string> = { first: "1.er toque", last: "último toque" };

/** Las claves de texto libre del toque y cómo se llaman. */
const TEXT_KEYS = [
  { key: "campaign", label: "Campaña", keywords: "utm_campaign" },
  { key: "content", label: "Contenido", keywords: "utm_content anuncio pieza" },
  { key: "term", label: "Término", keywords: "utm_term palabra clave" },
] as const;

/** Los parámetros de la URL: el primer toque sin sufijo (fuente y medio ya existían así), el último con `_ult`. */
const paramOf = (touch: Touch, base: string) => (touch === "first" ? base : `${base}_ult`);
const TEXT_PARAM: Record<(typeof TEXT_KEYS)[number]["key"], string> = { campaign: "campana", content: "contenido", term: "termino" };

/** Fuente y medio del último toque (los del primero están en el catálogo base, con sus parámetros de siempre). */
const LAST_TOUCH_LISTS: ContactFilterDef[] = [
  multiColumnFilter({
    param: paramOf("last", "fuente"),
    label: "Fuente",
    chipLabel: "Fuente (último toque)",
    group: GROUPS.lastTouch,
    column: `${TOUCH_PATH.last}->>source`,
    accepts: (v) => (SOURCES as readonly string[]).includes(v),
    options: { static: SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] })) },
    keywords: "origen utm_source",
  }),
  multiColumnFilter({
    param: paramOf("last", "medio"),
    label: "Medio",
    chipLabel: "Medio (último toque)",
    group: GROUPS.lastTouch,
    column: `${TOUCH_PATH.last}->>medium`,
    accepts: (v) => (MEDIUMS as readonly string[]).includes(v),
    options: { static: MEDIUMS.map((m) => ({ value: m, label: MEDIUM_LABELS[m] })) },
    keywords: "utm_medium",
  }),
];

const TEXT_FILTERS: ContactFilterDef[] = (["first", "last"] as const).flatMap((touch) =>
  TEXT_KEYS.map((k) =>
    multiColumnFilter({
      param: paramOf(touch, TEXT_PARAM[k.key]),
      label: k.label,
      chipLabel: `${k.label} (${TOUCH_SUFFIX[touch]})`,
      group: TOUCH_GROUP[touch],
      column: `${TOUCH_PATH[touch]}->>${k.key}`,
      accepts: isSafeText,
      options: { from: `${touch}_${k.key}` },
      keywords: k.keywords,
    }),
  ),
);

// ---------------------------------------------------------------------------
// Columnas
// ---------------------------------------------------------------------------

function touchOf(row: ContactRecord, touch: Touch): AttributionTouch | undefined {
  const a = readAttribution(row.attribution);
  return touch === "first" ? a.first_touch : a.last_touch;
}
const textCell = (v: string | undefined): CellValue => (v && v.trim() ? { t: "text", text: v.trim() } : null);

function touchColumns(touch: Touch): ContactColumnDef[] {
  const col = (key: string, label: string, cell: (t: AttributionTouch) => CellValue, keywords?: string): ContactColumnDef => ({
    key: `${touch}_${key}`,
    label: `${label} (${TOUCH_SUFFIX[touch]})`,
    group: TOUCH_GROUP[touch],
    hideable: true,
    defaultVisible: false,
    source: "contact",
    keywords,
    cell: (row) => {
      const t = touchOf(row, touch);
      return t ? cell(t) : null;
    },
  });
  const out = [
    col("source", "Fuente", (t) => (t.source ? { t: "text", text: sourceLabel(t.source) } : null), "origen utm_source"),
    col("medium", "Medio", (t) => (t.medium ? { t: "text", text: mediumLabel(t.medium) } : null), "utm_medium"),
    col("campaign", "Campaña", (t) => textCell(t.campaign), "utm_campaign"),
    col("content", "Contenido", (t) => textCell(t.content), "utm_content"),
    col("term", "Término", (t) => textCell(t.term), "utm_term"),
  ];
  if (touch === "last") out.push(col("at", "Fecha", (t) => (t.occurred_at ? { t: "date", at: t.occurred_at, mode: "day" } : null)));
  return out;
}

// ---------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------

/** Convierte lo que devuelve la función de la base en las opciones de cada filtro. Ignora lo que no tiene forma. */
export function attributionOptionsFromRpc(data: unknown): Record<string, MultiFilterOption[]> {
  const out: Record<string, MultiFilterOption[]> = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const touch of ["first", "last"] as const) {
    for (const k of TEXT_KEYS) {
      const list = (data as Record<string, unknown>)[`${touch}_${k.key}`];
      if (!Array.isArray(list)) continue;
      out[`${touch}_${k.key}`] = list.filter((v): v is string => typeof v === "string" && isSafeText(v)).map((v) => ({ value: v, label: v }));
    }
  }
  return out;
}

export const attributionModule: ContactListModule = {
  key: "atribucion",
  filters: [...TEXT_FILTERS.slice(0, 3), ...LAST_TOUCH_LISTS, ...TEXT_FILTERS.slice(3)],
  columns: [...touchColumns("first"), ...touchColumns("last")],
  async loadOptions(supabase, workspaceId) {
    const { data, error } = await supabase.rpc("contact_attribution_options", { p_workspace_id: workspaceId });
    if (error) {
      // Sin la 00283 aplicada, la función no existe: los filtros de campaña, contenido y término quedan sin opciones.
      if (error.code === "PGRST202") console.warn("[contacts] falta la función contact_attribution_options (migración 00283)");
      else console.error("[contacts] opciones de atribución fallidas:", error.message);
      return {};
    }
    return attributionOptionsFromRpc(data);
  },
};
