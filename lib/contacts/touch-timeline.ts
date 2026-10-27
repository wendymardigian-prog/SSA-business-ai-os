/**
 * La linea de tiempo de toques de la ficha (Extra I, F45).
 *
 * "Ver todos los toques" muestra la lista completa del contacto, del mas nuevo al mas viejo, con el canal de cada
 * uno y tres marcas: **Primer toque**, **Último toque** y **Último con origen** (el ultimo con canal organico,
 * pauta o referido: el que `contact_last_origin_touch` calcula en la base, por el mismo orden).
 *
 * Orden: `occurred_at desc, created_at desc, id desc` (el MISMO desempate que `record_contact_touch`, asi "primero"
 * y "ultimo" coinciden con los de `contacts.attribution`). Las marcas se calculan sobre TODOS los toques, no solo
 * sobre la pagina que se muestra. Paginada de a 50.
 *
 * El detalle de cada toque (UTM, ids de clic, anuncio, pieza) lo arma `describeTouch` —el mismo de la seccion de
 * Atribucion— para que las dos pantallas hablen igual.
 *
 * Modulo PURO.
 */
import { CHANNEL_LABELS, isOriginChannel, touchChannel, TOUCH_CHANNELS, type TouchChannel } from "@/lib/attribution/channel";
import { accountOfRaw, describeTouch, type MetaNames, type TouchRow, type TouchView } from "./attribution-view";
import type { AttributionTouch } from "./attribution";

/** Una fila de `contact_touches` con lo que la linea de tiempo necesita (todo lo de la ficha mas el orden y el canal). */
export type TimelineTouch = TouchRow & {
  created_at?: string | null;
  /** `contact_touches.channel` (00230). Si falta (fila anterior al backfill), se calcula con `touchChannel`. */
  channel?: string | null;
  social_post_id?: string | null;
};

export type TimelineMark = "first" | "last" | "last_origin";

export const MARK_LABELS: Record<TimelineMark, string> = {
  first: "Primer toque",
  last: "Último toque",
  last_origin: "Último con origen",
};

/** Como se llama cada `origin` en la lista (el vocabulario de F45). */
export const TIMELINE_ORIGIN_LABELS: Record<string, string> = {
  dm: "Mensaje directo",
  comment: "Comentario",
  link_click: "Clic en un link",
  booking: "Agenda",
  form: "Formulario", // @plantilla-quitar(formularios)
  webhook: "Webhook", // @plantilla-quitar(webhooks)
  manual: "Alta manual",
  import: "Importación",
};

export interface TimelineItem {
  id: string;
  occurredAt: string;
  channel: TouchChannel;
  channelLabel: string;
  origin: string;
  originLabel: string;
  /** Las marcas de este toque (puede tener mas de una: el ultimo suele ser tambien el ultimo con origen). */
  marks: TimelineMark[];
  markLabels: string[];
  contentPostId: string | null;
  socialPostId: string | null;
  /** El anuncio de Meta si el toque esta vinculado, si no el `ad_id` que trajo. */
  adId: string | null;
  /** La frase, la pieza con su link, el anuncio, la fecha y el detalle plegado (UTM, ids de clic, pagina). */
  view: TouchView;
}

export interface Timeline {
  items: TimelineItem[];
  /** Cuantos toques tiene el contacto en total. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** Los ids de las tres marcas sobre la lista completa (null si no hay toques / no hay uno con origen). */
  firstTouchId: string | null;
  lastTouchId: string | null;
  lastOriginTouchId: string | null;
}

export const TIMELINE_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const time = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Del mas nuevo al mas viejo: `occurred_at desc, created_at desc, id desc`. */
export function compareTouchesNewestFirst(a: TimelineTouch, b: TimelineTouch): number {
  return (
    time(b.occurred_at) - time(a.occurred_at) ||
    time(b.created_at) - time(a.created_at) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/** El canal guardado, o el calculado si la fila no lo trae (o trae algo que no es un canal). */
export function channelOf(touch: TimelineTouch): TouchChannel {
  if (touch.channel && (TOUCH_CHANNELS as readonly string[]).includes(touch.channel)) return touch.channel as TouchChannel;
  const raw = touch.raw && typeof touch.raw === "object" && !Array.isArray(touch.raw) ? (touch.raw as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return touchChannel({
    origin: touch.origin,
    medium: touch.medium,
    source: touch.source,
    ad_id: touch.ad_id ?? text(raw.ad_id),
    adset_id: touch.adset_id,
    campaign_id: touch.campaign_id,
    meta_ad_id: touch.meta_ad_id,
    meta_campaign_id: touch.meta_campaign_id,
    gclid: touch.gclid,
    ttclid: touch.ttclid,
    li_fat_id: touch.li_fat_id,
    ctwa_clid: touch.ctwa_clid,
    fbclid: touch.fbclid,
    social_post_id: touch.social_post_id,
    content_post_id: touch.content_post_id,
  });
}

const asAttributionTouch = (row: TimelineTouch): AttributionTouch => ({
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
  entry_url: row.entry_url ?? undefined,
  meta_campaign_id: row.meta_campaign_id ?? undefined,
  meta_adset_id: row.meta_adset_id ?? undefined,
  meta_ad_id: row.meta_ad_id ?? undefined,
  meta_match_status: row.meta_match_status && row.meta_match_status !== "none" ? row.meta_match_status : undefined,
  meta_match_method: row.meta_match_method ?? undefined,
});

export interface TimelineOptions {
  /** Pagina, desde 1. Una pagina fuera de rango se lleva al borde mas cercano. */
  page?: number;
  pageSize?: number;
  /** Zona horaria de quien mira, para las fechas. */
  timeZone?: string;
  /** Los nombres del catalogo de Meta (los arma la ficha con la sesion de quien mira). */
  names?: MetaNames;
  /** `forms.id` -> nombre, para los toques de formulario sin `utm_content`. */
  formNames?: Record<string, string>;
}

function formNameOf(row: TimelineTouch, formNames: Record<string, string> | undefined): string | null {
  if (row.origin !== "form" || row.content_label) return null;
  const id = (row.raw as { source_id?: unknown } | null | undefined)?.source_id;
  return typeof id === "string" ? (formNames?.[id] ?? null) : null;
}

/** La linea de tiempo: ordenada, con marcas, canal por toque y paginada. Nunca lanza con una lista vacia. */
export function buildTimeline(touches: readonly TimelineTouch[], options: TimelineOptions = {}): Timeline {
  const sorted = [...touches].sort(compareTouchesNewestFirst);
  const total = sorted.length;

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(options.pageSize ?? TIMELINE_PAGE_SIZE) || TIMELINE_PAGE_SIZE));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Math.floor(options.page ?? 1);
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requested) ? requested : 1));

  const channels = new Map<string, TouchChannel>(sorted.map((t) => [t.id, channelOf(t)]));

  // Las marcas se calculan sobre la lista completa: el primero esta en la ultima pagina y puede no mostrarse.
  const newest = sorted[0] ?? null;
  const oldest = sorted[total - 1] ?? null;
  const lastOrigin = sorted.find((t) => isOriginChannel(channels.get(t.id))) ?? null;

  const slice = sorted.slice((page - 1) * pageSize, page * pageSize);
  const items: TimelineItem[] = slice.map((touch) => {
    const channel = channels.get(touch.id) ?? "direct";
    const marks: TimelineMark[] = [];
    if (oldest && touch.id === oldest.id) marks.push("first");
    if (newest && touch.id === newest.id) marks.push("last");
    if (lastOrigin && touch.id === lastOrigin.id) marks.push("last_origin");

    const view = describeTouch(asAttributionTouch(touch), options.timeZone, formNameOf(touch, options.formNames), options.names, accountOfRaw(touch.raw));
    return {
      id: touch.id,
      occurredAt: touch.occurred_at,
      channel,
      channelLabel: CHANNEL_LABELS[channel],
      origin: touch.origin,
      originLabel: TIMELINE_ORIGIN_LABELS[touch.origin] ?? touch.origin,
      marks,
      markLabels: marks.map((m) => MARK_LABELS[m]),
      contentPostId: touch.content_post_id ?? null,
      socialPostId: touch.social_post_id ?? null,
      adId: touch.meta_ad_id ?? touch.ad_id ?? null,
      view,
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    pageCount,
    hasPrev: page > 1,
    hasNext: page < pageCount,
    firstTouchId: oldest?.id ?? null,
    lastTouchId: newest?.id ?? null,
    lastOriginTouchId: lastOrigin?.id ?? null,
  };
}
