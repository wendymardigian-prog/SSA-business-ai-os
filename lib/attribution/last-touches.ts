/**
 * «Último click» de una reunión: los últimos toques del contacto antes de agendar, de cualquier canal, listos
 * para mostrar. Puro: la consulta (`booking_last_touches`, 00358) y los nombres los trae `last-touches-load.ts`.
 *
 * Un toque es un click o una visita (un anuncio, una publicación, un mensaje directo, un comentario, un link...).
 * El «último click» es el más reciente que ocurrió hasta el momento de agendar; si hay un anuncio de Meta vinculado se
 * muestra el anuncio, si hay una pieza orgánica vinculada se muestra la pieza, y si no, de dónde vino.
 */
import { channelOfTouch, touchTitle, type TouchNames } from "@/lib/attribution/touch-label";
import type { TouchChannel } from "@/lib/attribution/channel";
import { TIMELINE_ORIGIN_LABELS } from "@/lib/contacts/touch-timeline";
import { sourceLabel } from "@/lib/contacts/taxonomy";

/** Una fila de `booking_last_touches`. */
export interface LastTouchRow {
  booking_id: string;
  touch_rank: number;
  touch_id: string;
  occurred_at: string;
  source: string;
  medium: string | null;
  campaign: string | null;
  content_label: string | null;
  term: string | null;
  origin: string;
  channel: string | null;
  social_post_id: string | null;
  content_post_id: string | null;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  meta_match_status: string | null;
  entry_url: string | null;
}

/** Cuántos toques se muestran por reunión. */
export const LAST_TOUCHES_SHOWN = 3;

/** Los nombres y miniaturas que se pudieron leer con la sesión de quien mira. */
export interface LastTouchNames extends TouchNames {
  /** Id de anuncio de Meta -> miniatura firmada (solo con `dashboards.ads.view`). */
  adThumbnails: Record<string, string>;
}

export const NO_LAST_TOUCH_NAMES: LastTouchNames = { pieces: {}, ads: {}, adThumbnails: {} };

/** Un toque ya resuelto, solo con texto y ids: viaja tal cual al navegador. */
export interface BookingTouchView {
  id: string;
  /** Cuándo fue, en ISO. */
  at: string;
  channel: TouchChannel;
  /** El nombre del anuncio, la pieza, la campaña o «Instagram · mensaje directo». */
  title: string;
  /** Cómo entró: «Mensaje directo», «Formulario», «Agenda»... Vacío si no se sabe. */
  originLabel: string;
  /** «Instagram», «Meta»... Vacío si no hay fuente. */
  sourceLine: string;
  kind: "ad" | "piece" | "other";
  adId: string | null;
  thumbnailUrl: string | null;
  pieceId: string | null;
}

export function toTouchView(row: LastTouchRow, names: LastTouchNames): BookingTouchView {
  const adId = row.meta_ad_id ?? row.ad_id;
  const kind: BookingTouchView["kind"] = adId ? "ad" : row.content_post_id ? "piece" : "other";
  return {
    id: row.touch_id,
    at: row.occurred_at,
    channel: channelOfTouch({ ...row }),
    title: touchTitle(row, names),
    originLabel: TIMELINE_ORIGIN_LABELS[row.origin] ?? "",
    sourceLine: row.source && row.source !== "web" ? sourceLabel(row.source) : "",
    kind,
    adId: adId ?? null,
    thumbnailUrl: adId ? (names.adThumbnails[adId] ?? null) : null,
    pieceId: row.content_post_id ?? null,
  };
}

/** Agrupa las filas por reunión, en orden (la más reciente primero), y recorta a lo que se muestra. */
export function groupLastTouches(rows: readonly LastTouchRow[], names: LastTouchNames): Record<string, BookingTouchView[]> {
  const sorted = [...rows].sort((a, b) => a.booking_id.localeCompare(b.booking_id) || a.touch_rank - b.touch_rank);
  const out: Record<string, BookingTouchView[]> = {};
  for (const row of sorted) {
    const list = (out[row.booking_id] ??= []);
    if (list.length < LAST_TOUCHES_SHOWN) list.push(toTouchView(row, names));
  }
  return out;
}

/** La línea del último click para una celda o el celular: «Pauta · N3 · Usar no paga». Vacía si no hay toque. */
export function lastClickLine(touches: readonly BookingTouchView[] | undefined): string {
  const last = touches?.[0];
  if (!last) return "";
  return last.title || last.sourceLine || last.originLabel;
}
