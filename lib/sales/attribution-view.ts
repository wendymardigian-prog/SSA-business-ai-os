/**
 * Como se muestra de donde vino una venta (Extra I, F49): el canal y, segun el toque, la pieza con su responsable, el
 * anuncio con su camino, quien refirio o "Sin origen identificado".
 *
 * Es PURO: los datos (el toque, la pieza, la publicacion, el anuncio, quien refirio) los lee quien llama con el
 * cliente de la sesion, y la RLS decide que se ve. Lo que no se ve no se inventa: se dice con lo que si hay.
 *
 * Los cuatro casos:
 *   organico ... «Reel: …» (link a la pieza) · Instagram · responsable
 *   pauta ...... Campaña › Conjunto › Anuncio, con la miniatura si hay catalogo
 *   referido ... quien lo recomendo
 *   directo .... «Sin origen identificado» (y el evento o la nota, si los hay)
 */
import { touchChannel, type TouchChannel, type TouchChannelInput } from "@/lib/attribution/channel";
import { pieceHref } from "@/lib/contacts/attribution-view";
import { channelLabel, isChannel, mediumLabel, sourceLabel } from "@/lib/contacts/taxonomy";
import { adDetailHref } from "@/lib/meta/content-ad-summary";
import type { SaleAttribution } from "@/lib/attribution/attribution";

/** Lo que la venta guarda de su atribucion. */
export interface ViewSale {
  attribution_type: string;
  attribution: unknown;
  attribution_touch_id?: string | null;
}

/** El toque al que apunta la venta (`contact_touches`), en lo que esta vista usa. */
export interface ViewTouch {
  id: string;
  occurred_at: string;
  channel?: string | null;
  origin?: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content_label: string | null;
  content_post_id: string | null;
  social_post_id: string | null;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  meta_campaign_id?: string | null;
  meta_adset_id?: string | null;
  meta_ad_id?: string | null;
  gclid?: string | null;
  ttclid?: string | null;
  li_fat_id?: string | null;
  ctwa_clid?: string | null;
  fbclid?: string | null;
  raw?: unknown;
}

export interface ViewPerson {
  id: string;
  name: string;
}

export interface ViewPiece {
  id: string;
  title: string;
  /** El responsable de la pieza (`content_posts.assigned_to`), con su nombre si se conoce. */
  assignee: ViewPerson | null;
}

export interface ViewPublication {
  id: string;
  platform: string | null;
  /** Una publicacion sin pieza tiene su propio responsable (`social_posts.assigned_to`). */
  assignee: ViewPerson | null;
}

export interface ViewAd {
  adId: string | null;
  adAccountId: string | null;
  campaignName: string | null;
  adsetName: string | null;
  adName: string | null;
  thumbnailUrl: string | null;
}

export interface ViewReferrer {
  type: "contact" | "member";
  id: string;
  name: string | null;
}

export interface SaleAttributionOptions {
  /** `dashboards.ads.view`: solo con el el anuncio lleva a su detalle. */
  canViewAds?: boolean;
  referrer?: ViewReferrer | null;
}

export interface SaleAttributionViewModel {
  /** El canal, o null si la venta no tiene ninguna atribucion. */
  channel: TouchChannel | null;
  /** "Orgánico", "Pauta", "Referido", "Directo" o "Sin origen". */
  channelLabel: string;
  /** Una linea corta, lista para la columna «Origen» de la lista. */
  summary: string;
  /** No hay origen identificado: la pantalla dice «Sin origen identificado». */
  unidentified: boolean;
  /** La fecha del toque (ISO), para formatearla en la zona de quien mira. */
  occurredAt: string | null;
  piece: { title: string | null; href: string | null; network: string | null; responsible: ViewPerson | null } | null;
  ad: { path: string[]; thumbnailUrl: string | null; href: string | null } | null;
  referrer: { name: string | null; href: string | null; kind: "contact" | "member" } | null;
  /** El evento o la nota de un toque directo cargado a mano. */
  note: string | null;
}

const PIECE_CODE = /^c[a-z2-9]{5}$/;

const clean = (v: string | null | undefined): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
};

const NETWORK_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  threads: "Threads",
  twitter: "X",
  manual: "Otra red",
};
const networkLabel = (v: string | null | undefined): string | null => {
  const t = clean(v)?.toLowerCase();
  return t ? (NETWORK_LABELS[t] ?? sourceLabel(t)) : null;
};

/** La copia congelada de la venta como lo que `touchChannel` necesita (para una venta sin fila de toque). */
function channelInputOfCopy(copy: SaleAttribution | null): TouchChannelInput | null {
  if (!copy) return null;
  return {
    source: copy.source ?? null,
    medium: copy.medium ?? null,
    ad_id: copy.ad_id ?? null,
    adset_id: copy.adset_id ?? null,
    campaign_id: copy.campaign_id ?? null,
    gclid: copy.gclid ?? null,
    ttclid: copy.ttclid ?? null,
    li_fat_id: copy.li_fat_id ?? null,
    ctwa_clid: copy.ctwa_clid ?? null,
    fbclid: copy.fbclid ?? null,
  };
}

const asCopy = (value: unknown): SaleAttribution | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as SaleAttribution) : null);

const rawOf = (touch: ViewTouch | null): Record<string, unknown> =>
  touch?.raw && typeof touch.raw === "object" && !Array.isArray(touch.raw) ? (touch.raw as Record<string, unknown>) : {};

/**
 * El modelo de «De dónde vino». `touch` es el toque al que apunta la venta (null si no hay, por ejemplo una venta sin
 * atribucion o una cargada a mano sin toque); `piece`, `publication` y `ad` son lo que se pudo leer de ese toque.
 */
export function saleAttributionView(
  sale: ViewSale,
  touch: ViewTouch | null,
  piece: ViewPiece | null,
  publication: ViewPublication | null,
  ad: ViewAd | null,
  options: SaleAttributionOptions = {},
): SaleAttributionViewModel {
  const copy = sale.attribution_type === "none" ? null : asCopy(sale.attribution);

  // Sin toque y sin copia: la venta no tiene origen.
  if (!touch && !copy) return emptyView();

  const channel: TouchChannel = touch
    ? isChannel(touch.channel)
      ? touch.channel
      : touchChannel(touch)
    : touchChannel(channelInputOfCopy(copy));

  const source = clean(touch?.source ?? copy?.source);
  const occurredAt = touch?.occurred_at ?? clean(copy?.occurred_at);

  switch (channel) {
    case "organic": {
      const pieceId = piece?.id ?? touch?.content_post_id ?? null;
      const labelText = clean(touch?.content_label ?? copy?.content);
      const title = clean(piece?.title) ?? (labelText && !PIECE_CODE.test(labelText.toLowerCase()) ? labelText : null);
      const network = networkLabel(publication?.platform) ?? networkLabel(source);
      const responsible = piece ? piece.assignee : (publication?.assignee ?? null);
      const summary = [title ?? "Pieza sin identificar", network].filter(Boolean).join(" · ");
      return {
        channel,
        channelLabel: channelLabel(channel),
        summary,
        unidentified: false,
        occurredAt,
        piece: { title, href: pieceId ? pieceHref(pieceId) : null, network, responsible },
        ad: null,
        referrer: null,
        note: null,
      };
    }

    case "paid": {
      const adId = clean(touch?.meta_ad_id ?? touch?.ad_id ?? copy?.ad_id);
      const adsetId = clean(touch?.meta_adset_id ?? touch?.adset_id ?? copy?.adset_id);
      const campaignId = clean(touch?.meta_campaign_id ?? touch?.campaign_id ?? copy?.campaign_id);
      const path = [
        campaignId || ad?.campaignName ? (clean(ad?.campaignName) ?? `Campaña ${campaignId}`) : null,
        adsetId || ad?.adsetName ? (clean(ad?.adsetName) ?? `Conjunto ${adsetId}`) : null,
        adId || ad?.adName ? (clean(ad?.adName) ?? `Anuncio ${adId}`) : null,
      ].filter((p): p is string => !!p);
      const network = networkLabel(source);
      const href = options.canViewAds && ad?.adId && ad.adAccountId ? adDetailHref(ad.adId, ad.adAccountId) : null;
      return {
        channel,
        channelLabel: channelLabel(channel),
        summary: path.length > 0 ? path[path.length - 1] : ["Anuncio", network].filter(Boolean).join(" · ") || "Anuncio",
        unidentified: false,
        occurredAt,
        piece: null,
        ad: { path, thumbnailUrl: ad?.thumbnailUrl ?? null, href },
        referrer: null,
        note: path.length === 0 && network ? `${network}, sin anuncio identificado` : null,
      };
    }

    case "referral": {
      const referrer = options.referrer ?? null;
      return {
        channel,
        channelLabel: channelLabel(channel),
        summary: referrer?.name ? `Referido por ${referrer.name}` : "Referido",
        unidentified: false,
        occurredAt,
        piece: null,
        ad: null,
        referrer: referrer ? { name: referrer.name, href: referrer.type === "contact" ? `/dashboard/contacts/${referrer.id}` : null, kind: referrer.type } : null,
        note: null,
      };
    }

    case "direct": {
      const medium = clean(touch?.medium ?? copy?.medium);
      const campaign = clean(touch?.campaign ?? copy?.campaign);
      let note: string | null = null;
      if (medium === "event") note = campaign ? `Evento o llamada en frío: ${campaign}` : "Evento o llamada en frío";
      else if (medium === "other") note = campaign ? `Otro: ${campaign}` : null;
      else {
        const via = [sourceLabel(source), mediumLabel(medium)].filter(Boolean).join(" · ");
        note = via || null;
      }
      return {
        channel,
        channelLabel: channelLabel(channel),
        summary: "Sin origen identificado",
        unidentified: true,
        occurredAt,
        piece: null,
        ad: null,
        referrer: null,
        note,
      };
    }
  }
}

function emptyView(): SaleAttributionViewModel {
  return {
    channel: null,
    channelLabel: "Sin origen",
    summary: "Sin origen identificado",
    unidentified: true,
    occurredAt: null,
    piece: null,
    ad: null,
    referrer: null,
    note: null,
  };
}

/** Los ids que hay que leer para armar la vista de un toque (los usa el cargador). */
export function touchReferences(touch: ViewTouch | null): {
  pieceId: string | null;
  publicationId: string | null;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  referrerContactId: string | null;
  referrerUserId: string | null;
} {
  const raw = rawOf(touch);
  const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);
  return {
    pieceId: touch?.content_post_id ?? null,
    publicationId: touch?.social_post_id ?? null,
    adId: clean(touch?.meta_ad_id ?? touch?.ad_id),
    adsetId: clean(touch?.meta_adset_id ?? touch?.adset_id),
    campaignId: clean(touch?.meta_campaign_id ?? touch?.campaign_id),
    referrerContactId: uuid(raw.referrer_contact_id),
    referrerUserId: uuid(raw.referrer_user_id),
  };
}
