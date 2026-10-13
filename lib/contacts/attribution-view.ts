/**
 * Cómo se muestra la atribución de un contacto (F88).
 *
 * Las decisiones de pantalla viven acá, puras y con test; los componentes solo
 * las componen. Qué se muestra:
 *
 *   - EL PRIMER TOQUE y EL ÚLTIMO, en una frase que se lee sola:
 *     "Instagram · comentario · Reel «cómo cobrar en dólares» · 12 sep".
 *   - Si hay un solo toque, el primero y el último son el mismo y se muestra UNA
 *     vez: dos tarjetas iguales parecen dos eventos.
 *   - Debajo, el CAMINO COMPLETO, en orden, plegado por defecto.
 *   - Cuando el toque trae una pieza, su nombre es un link a esa pieza.
 *
 * Sin dato no se inventa nada: ni ceros ni guiones, un estado vacío.
 */

import { drawerHref } from "@/lib/content/drawer-url";
import { readAttribution, type AttributionTouch } from "./attribution";
import { mediumLabel, sourceLabel } from "./taxonomy";

/** Un toque guardado en la tabla `contact_touches`, en lo que la pantalla usa. */
export interface TouchRow {
  id: string;
  occurred_at: string;
  source: string;
  medium: string | null;
  content_label: string | null;
  content_post_id: string | null;
  origin: string;
  campaign?: string | null;
  term?: string | null;
  ad_id?: string | null;
  adset_id?: string | null;
  campaign_id?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  ttclid?: string | null;
  li_fat_id?: string | null;
  ctwa_clid?: string | null;
  referrer_url?: string | null;
  landing_page?: string | null;
  /** La carga original del toque (lista blanca): de ahi sale `source_id`, el formulario de un toque de formulario. */
  raw?: unknown;
}

export interface TouchView {
  /** La frase completa, lista para mostrar. */
  text: string;
  /** Solo la parte del origen ("Instagram · comentario"), sin pieza ni fecha. */
  origin: string;
  /** El nombre de la pieza, si el toque la trae. */
  piece: string | null;
  /** A dónde lleva el nombre de la pieza. Null si no se conoce la pieza. */
  href: string | null;
  /** "12 sep", o vacío si el toque no tiene fecha. */
  when: string;
  /** El medio no era de la lista: se guardó tal cual vino. */
  rawMedium: boolean;
  /** Campaña › conjunto › anuncio, solo con los ids que el toque trae (sin catálogo todavía: ids crudos). */
  ad: { campaign: string | null; adset: string | null; ad: string | null } | null;
  /** "Meta · Campaña 1 › Conjunto 2 › Anuncio 3", o null si el toque no vino de un anuncio. */
  adLine: string | null;
  /** El detalle plegado: UTMs, ids de clic y página de llegada. Solo lo que el toque trae. */
  details: { label: string; value: string }[];
}

export interface AttributionView {
  /** No hay nada que mostrar. */
  empty: boolean;
  first: TouchView | null;
  /** Null cuando es el mismo toque que `first`: se muestra una sola vez. */
  last: TouchView | null;
  /** Todos los toques, del más viejo al más nuevo. Vacío si no hay tabla que leer. */
  path: TouchView[];
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "12 sep" en la zona de quien mira (o UTC si no se la pasaron). */
export function shortDate(iso: string | null | undefined, timeZone = "UTC"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, month: "2-digit", day: "2-digit" }).formatToParts(date);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    return `${day} ${MONTHS[month - 1]}`;
  } catch {
    // Una zona inválida no puede romper la ficha: se cae a UTC.
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  }
}

/** A dónde lleva una pieza. La ruta vieja redirige al drawer (F99). */
export const pieceHref = (contentPostId: string) =>
  drawerHref(new URLSearchParams(), { kind: "piece", id: contentPostId });

/** Un toque, dicho en palabras. Funciona con el de la copia derivada y con una fila. */
export function describeTouch(
  touch: Pick<AttributionTouch, "source" | "medium" | "medium_raw" | "content" | "content_post_id" | "occurred_at"> &
    Partial<
      Pick<
        AttributionTouch,
        | "campaign"
        | "term"
        | "ad_id"
        | "adset_id"
        | "campaign_id"
        | "fbclid"
        | "gclid"
        | "ttclid"
        | "li_fat_id"
        | "ctwa_clid"
        | "referrer_url"
        | "landing_page"
      >
    >,
  timeZone?: string,
  /** El nombre del formulario de un toque de formulario sin `utm_content` (el formulario ya no se inventa como contenido). */
  formName?: string | null,
): TouchView {
  const source = sourceLabel(touch.source);
  const medium = mediumLabel(touch.medium);
  const origin = [source, medium].filter(Boolean).join(" · ");
  const piece = touch.content?.trim() || formName?.trim() || null;
  const when = shortDate(touch.occurred_at, timeZone);

  const text = [origin, piece ? `«${piece}»` : null, when || null].filter(Boolean).join(" · ");

  const ad =
    touch.ad_id || touch.adset_id || touch.campaign_id
      ? { campaign: touch.campaign_id ?? null, adset: touch.adset_id ?? null, ad: touch.ad_id ?? null }
      : null;
  const adLine = ad
    ? [
        sourceLabel(touch.source) ? "Anuncio · " + sourceLabel(touch.source) : "Anuncio",
        [
          ad.campaign ? `Campaña ${ad.campaign}` : null,
          ad.adset ? `Conjunto ${ad.adset}` : null,
          ad.ad ? `Anuncio ${ad.ad}` : null,
        ]
          .filter(Boolean)
          .join(" › "),
      ].join(" · ")
    : null;

  const detailPairs: [string, string | undefined][] = [
    ["Campaña (UTM)", touch.campaign],
    ["Término", touch.term],
    ["Clic de Facebook (fbclid)", touch.fbclid],
    ["Clic de Google (gclid)", touch.gclid],
    ["Clic de TikTok (ttclid)", touch.ttclid],
    ["Clic de LinkedIn (li_fat_id)", touch.li_fat_id],
    ["Clic a WhatsApp (ctwa_clid)", touch.ctwa_clid],
    ["Venía de", touch.referrer_url],
    ["Página de llegada", touch.landing_page],
  ];
  const details = detailPairs
    .filter((pair): pair is [string, string] => typeof pair[1] === "string" && pair[1].trim() !== "")
    .map(([label, value]) => ({ label, value: value.trim() }));

  return {
    text,
    origin,
    piece,
    href: touch.content_post_id ? pieceHref(touch.content_post_id) : null,
    when,
    rawMedium: touch.medium_raw === true,
    ad,
    adLine,
    details,
  };
}

const fromRow = (row: TouchRow): AttributionTouch => ({
  occurred_at: row.occurred_at,
  source: row.source,
  medium: row.medium ?? undefined,
  content: row.content_label ?? undefined,
  content_post_id: row.content_post_id ?? undefined,
  campaign: row.campaign ?? undefined,
  term: row.term ?? undefined,
  ad_id: row.ad_id ?? undefined,
  adset_id: row.adset_id ?? undefined,
  campaign_id: row.campaign_id ?? undefined,
  fbclid: row.fbclid ?? undefined,
  gclid: row.gclid ?? undefined,
  ttclid: row.ttclid ?? undefined,
  li_fat_id: row.li_fat_id ?? undefined,
  ctwa_clid: row.ctwa_clid ?? undefined,
  referrer_url: row.referrer_url ?? undefined,
  landing_page: row.landing_page ?? undefined,
});

/** Dos toques son el mismo si dicen lo mismo. */
const sameTouch = (a: AttributionTouch, b: AttributionTouch) => JSON.stringify(a) === JSON.stringify(b);

/**
 * El modelo de la sección de atribución.
 *
 * `rows` es opcional: la ficha lee la tabla de toques para mostrar el camino, y
 * el panel de la bandeja, que no, usa solo la copia de `contacts.attribution`.
 */
export function buildAttributionView(params: {
  attribution: unknown;
  rows?: TouchRow[];
  timeZone?: string;
  /** `forms.id` -> nombre, para los toques de formulario (la ficha los busca por `raw.source_id`). */
  formNames?: Record<string, string>;
}): AttributionView {
  const { first_touch, last_touch } = readAttribution(params.attribution);
  const rows = params.rows ?? [];

  const formNameOfRow = (row: TouchRow): string | null => {
    if (row.origin !== "form" || row.content_label) return null;
    const id = (row.raw as { source_id?: unknown } | null | undefined)?.source_id;
    return typeof id === "string" ? (params.formNames?.[id] ?? null) : null;
  };
  // Los toques de la copia derivada no traen `raw`: se buscan en la tabla por su fecha (misma clave de orden).
  const formNameOfTouch = (touch: AttributionTouch): string | null => {
    if (touch.origin !== "form" || touch.content) return null;
    const row = rows.find((r) => r.origin === "form" && new Date(r.occurred_at).getTime() === new Date(touch.occurred_at ?? 0).getTime());
    return row ? formNameOfRow(row) : null;
  };

  const path = [...rows]
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime())
    .map((row) => describeTouch(fromRow(row), params.timeZone, formNameOfRow(row)));

  // Sin copia derivada pero con toques en la tabla (un contacto al que todavía no
  // se le calculó): el primero y el último salen de la propia tabla.
  const first = first_touch ?? (rows.length > 0 ? fromRow(sortedRows(rows)[0]) : undefined);
  const last = last_touch ?? (rows.length > 0 ? fromRow(sortedRows(rows)[rows.length - 1]) : undefined);

  if (!first && !last) return { empty: true, first: null, last: null, path: [] };

  const firstTouch = first ?? last!;
  const lastTouch = last ?? first!;
  const single = rows.length === 1 || sameTouch(firstTouch, lastTouch);

  return {
    empty: false,
    first: describeTouch(firstTouch, params.timeZone, formNameOfTouch(firstTouch)),
    last: single ? null : describeTouch(lastTouch, params.timeZone, formNameOfTouch(lastTouch)),
    path,
  };
}

function sortedRows(rows: TouchRow[]): TouchRow[] {
  return [...rows].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
}
