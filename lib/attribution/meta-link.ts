/**
 * El vínculo de una respuesta o una reunión con Meta, listo para mostrar. La fuente es SIEMPRE el toque
 * (`contact_touches.meta_*`): no hay una segunda copia en `form_submissions` ni en `bookings`. Puro.
 */
import { describeMatchMethod, describeMatchReasons } from "./meta-match-reasons";
import { metaIdsFrom, metaNamesFor, type MetaIds, type MetaNames, type MetaRowNames } from "./meta-names";

export interface MatchTouch {
  id: string;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  meta_match_status: string | null;
  meta_match_method: string | null;
  meta_match_reason: string | null;
}

/** Un toque de una respuesta o una reunión, con lo que hace falta para encontrarlo. */
export interface MatchTouchRow extends MatchTouch {
  contact_id: string;
  occurred_at: string;
  dedupe_key: string | null;
}

type MatchFields = {
  id: string;
  meta_campaign_id?: string | null;
  meta_adset_id?: string | null;
  meta_ad_id?: string | null;
  meta_match_status?: string | null;
  meta_match_method?: string | null;
  meta_match_reason?: string | null;
};

export type MetaLinkStatus = "matched" | "manual" | "unmatched" | "ignored" | "none";

const STATUS_LABELS: Record<MetaLinkStatus, string> = {
  matched: "Vinculado",
  manual: "A mano",
  unmatched: "Sin vincular",
  ignored: "Ignorado",
  none: "",
};

export interface MetaLink {
  /** El toque propio de la respuesta o reunión. Null si no tiene (por ejemplo, una reunión agendada a mano). */
  touchId: string | null;
  /** Lo que se muestra viene de un toque anterior del contacto, no de esta reunión. */
  inherited: boolean;
  status: MetaLinkStatus;
  statusLabel: string;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  names: MetaRowNames;
  /** Cómo se vinculó, en palabras. */
  method: string | null;
  /** Por qué no se pudo, o el aviso, en palabras. */
  reasons: string[];
  /** Lo ignoró el sistema por ser contenido orgánico: «Dejar de ignorar» volvería a ignorarlo solo. */
  autoIgnored: boolean;
}

const NO_NAMES: MetaRowNames = { campaign: null, adset: null, ad: null };

function statusOf(value: string | null | undefined): MetaLinkStatus {
  return value === "matched" || value === "manual" || value === "unmatched" || value === "ignored" ? value : "none";
}

/** Los ids del vínculo de un toque, para pedir sus nombres. */
export function touchMetaIds(touch: Pick<MatchTouch, "meta_campaign_id" | "meta_adset_id" | "meta_ad_id">): MetaIds {
  return { campaign: touch.meta_campaign_id, adset: touch.meta_adset_id, ad: touch.meta_ad_id };
}

export function metaLinkFromTouch(touch: MatchFields, names: MetaNames, options: { ownTouchId?: string | null; inherited?: boolean } = {}): MetaLink {
  const inherited = options.inherited === true;
  const status = statusOf(touch.meta_match_status);
  return {
    touchId: inherited ? (options.ownTouchId ?? null) : touch.id,
    inherited,
    status,
    statusLabel: STATUS_LABELS[status],
    campaignId: touch.meta_campaign_id ?? null,
    adsetId: touch.meta_adset_id ?? null,
    adId: touch.meta_ad_id ?? null,
    names: {
      campaign: touch.meta_campaign_id ? (names.campaigns[touch.meta_campaign_id] ?? null) : null,
      adset: touch.meta_adset_id ? (names.adsets[touch.meta_adset_id] ?? null) : null,
      ad: touch.meta_ad_id ? (names.ads[touch.meta_ad_id] ?? null) : null,
    },
    method: status === "matched" ? describeMatchMethod(touch.meta_match_method) : null,
    reasons: describeMatchReasons(touch.meta_match_reason),
    autoIgnored: status === "ignored" && (touch.meta_match_reason ?? "").includes("organic_content"),
  };
}

/** Sin toque (una respuesta sin contacto): solo los nombres de los ids que trajo su URL. No hay vínculo que cambiar. */
export function metaLinkFromAttribution(attribution: Record<string, unknown> | null | undefined, names: MetaNames): MetaLink {
  const ids = metaIdsFrom(attribution);
  return {
    touchId: null,
    inherited: false,
    status: "none",
    statusLabel: "",
    campaignId: ids.campaign,
    adsetId: ids.adset,
    adId: ids.ad,
    names: metaNamesFor(attribution, names),
    method: null,
    reasons: [],
    autoIgnored: false,
  };
}

/** «Campaña › Conjunto › Anuncio»: el nombre o, sin catálogo o sin permiso, el id. Vacío si no hay vínculo. */
export function metaLinkLine(link: MetaLink | null | undefined): string {
  if (!link) return "";
  const n = link.names ?? NO_NAMES;
  return [
    link.campaignId ? (n.campaign ?? `Campaña ${link.campaignId}`) : null,
    link.adsetId ? (n.adset ?? `Conjunto ${link.adsetId}`) : null,
    link.adId ? (n.ad ?? `Anuncio ${link.adId}`) : null,
  ]
    .filter(Boolean)
    .join(" › ");
}
