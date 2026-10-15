/**
 * Como se nombra un toque cuando hay que elegirlo o sugerirlo (Extra I, F46): el canal, la pieza o el anuncio y la
 * fecha. Puro: los nombres (titulos de piezas, nombres de anuncios) los trae quien llama, leidos con la sesion.
 */
import { isChannel, mediumLabel, sourceLabel } from "@/lib/contacts/taxonomy";
import { touchChannel, type TouchChannel, type TouchChannelInput } from "@/lib/attribution/channel";
import { localDate } from "./dates";

export interface TouchNames {
  /** `content_posts.id` -> titulo. */
  pieces: Record<string, string>;
  /** Id de anuncio de Meta -> nombre. */
  ads: Record<string, string>;
}

export const NO_NAMES: TouchNames = { pieces: {}, ads: {} };

export interface LabelableTouch extends TouchChannelInput {
  occurred_at: string;
  channel?: string | null;
  content_label?: string | null;
  campaign?: string | null;
}

/** El canal guardado en el toque, o el calculado si la fila no lo trae (un toque viejo). */
export function channelOfTouch(touch: TouchChannelInput & { channel?: string | null }): TouchChannel {
  return isChannel(touch.channel) ? touch.channel : touchChannel(touch);
}

/** El codigo corto de una pieza (`c` + 5 caracteres): no es un titulo, no se muestra como tal. */
const PIECE_CODE = /^c[a-z2-9]{5}$/;

/** "Reel: 3 errores…", el nombre del anuncio, la campaña o, al final, "Instagram · mensaje directo". */
export function touchTitle(touch: LabelableTouch & { source?: string | null; medium?: string | null }, names: TouchNames = NO_NAMES): string {
  const piece = touch.content_post_id ? names.pieces[touch.content_post_id] : null;
  if (piece?.trim()) return piece.trim();
  const label = touch.content_label?.trim();
  if (label && !PIECE_CODE.test(label.toLowerCase())) return label;
  const adId = touch.meta_ad_id ?? touch.ad_id;
  const ad = adId ? names.ads[adId] : null;
  if (ad?.trim()) return ad.trim();
  if (touch.campaign?.trim()) return touch.campaign.trim();
  const origin = [sourceLabel(touch.source), mediumLabel(touch.medium)].filter(Boolean).join(" · ");
  return origin || "Sin datos";
}

/** "3/10": dia y mes en la zona del negocio. */
export function shortDayMonth(iso: string, timeZone: string): string {
  const [, month, day] = localDate(iso, timeZone).split("-").map(Number);
  return `${day}/${month}`;
}
