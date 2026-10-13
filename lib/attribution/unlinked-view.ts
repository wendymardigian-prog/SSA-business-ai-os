/**
 * Lo que muestra «Sin vincular» (Extra L, AT3, F29): los toques que traen datos de un anuncio y no se
 * pudieron vincular, con lo que llego y el MOTIVO en palabras.
 *
 * Todo lo que decide que se muestra vive aca, puro y con test; la pantalla solo lo compone.
 */

import { decodeUtm, touchMetaInput } from "@/lib/attribution/meta-match";
import { describeMatchReasons, describeMatchMethod } from "@/lib/attribution/meta-match-reasons";
import { metaNameKey } from "@/lib/meta/name-key";
import { ORIGIN_LABELS, sourceLabel, type TouchOrigin } from "@/lib/contacts/taxonomy";
import { shortDate } from "@/lib/contacts/attribution-view";

/** Los dias que se pueden mirar hacia atras. */
export const UNLINKED_DAYS = [30, 90, 180, 365] as const;
export const DEFAULT_UNLINKED_DAYS = 90;
export const UNLINKED_PAGE_SIZE = 25;

export type UnlinkedView = "sin-vincular" | "manuales";

export function parseDays(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (UNLINKED_DAYS as readonly number[]).includes(n) ? n : DEFAULT_UNLINKED_DAYS;
}

export function parseView(value: string | string[] | undefined): UnlinkedView {
  return (Array.isArray(value) ? value[0] : value) === "manuales" ? "manuales" : "sin-vincular";
}

export function parsePage(value: string | string[] | undefined): number {
  const n = Math.floor(Number(Array.isArray(value) ? value[0] : value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Las columnas de `contact_touches` que usa la pantalla. */
export interface UnlinkedTouch {
  id: string;
  contact_id: string;
  occurred_at: string;
  source: string;
  medium: string | null;
  origin: string;
  campaign: string | null;
  content_label: string | null;
  term: string | null;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  fbclid: string | null;
  meta_match_status: string;
  meta_match_method: string | null;
  meta_match_reason: string | null;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
}

/** Cuantos anuncios / campañas comparten un nombre (por su clave), para los avisos de «hay N con ese nombre». */
export interface NameCounts {
  ads: Record<string, number>;
  campaigns: Record<string, number>;
}

export interface UnlinkedRow {
  touchId: string;
  contactId: string;
  contactName: string;
  /** "12 sep". */
  when: string;
  /** "Facebook · Reserva". */
  origin: string;
  /** Lo que llego, solo los valores que traen algo. */
  values: Array<{ label: string; value: string }>;
  /** El motivo, en frases. Vacio si es un vinculo manual. */
  reasons: string[];
  status: "unmatched" | "manual" | "ignored";
  /** Como se vinculo (lo manual lo dice). */
  method: string | null;
  /** Lo que se eligio a mano (los ids de Meta). */
  chosen: { adId: string | null; adsetId: string | null; campaignId: string | null } | null;
}

/** Las claves de nombre que hace falta contar para los toques con un motivo de nombre ambiguo. */
export function ambiguousKeys(touches: UnlinkedTouch[]): { ads: string[]; campaigns: string[] } {
  const ads = new Set<string>();
  const campaigns = new Set<string>();
  for (const t of touches) {
    const reason = t.meta_match_reason ?? "";
    const input = touchMetaInput({ origin: t.origin, adId: t.ad_id, adsetId: t.adset_id, campaignId: t.campaign_id, campaign: t.campaign, contentLabel: t.content_label, term: t.term, fbclid: t.fbclid });
    if (reason.includes("ambiguous_ad_name") && input.utmContent) ads.add(metaNameKey(decodeUtm(input.utmContent)));
    if (reason.includes("ambiguous_campaign_name") && input.utmCampaign) campaigns.add(metaNameKey(decodeUtm(input.utmCampaign)));
  }
  return { ads: [...ads].filter(Boolean), campaigns: [...campaigns].filter(Boolean) };
}

export function buildUnlinkedRows(params: {
  touches: UnlinkedTouch[];
  contactNames: Record<string, string>;
  counts?: NameCounts;
  timeZone?: string;
}): UnlinkedRow[] {
  const counts = params.counts ?? { ads: {}, campaigns: {} };

  return params.touches.map((t) => {
    // Lo que se muestra es lo que de verdad cuenta como dato de Meta (la regla de la 00194).
    const input = touchMetaInput({ origin: t.origin, adId: t.ad_id, adsetId: t.adset_id, campaignId: t.campaign_id, campaign: t.campaign, contentLabel: t.content_label, term: t.term, fbclid: t.fbclid });

    const values: UnlinkedRow["values"] = [];
    const push = (label: string, value: string | null | undefined) => {
      const v = (value ?? "").trim();
      if (v) values.push({ label, value: v });
    };
    push("ad_id", input.adId);
    push("adset_id", input.adsetId);
    push("campaign_id", input.campaignId);
    push("utm_campaign", input.utmCampaign);
    push("utm_content", input.utmContent);
    push("utm_term", input.utmTerm);
    if ((input.fbclid ?? "").trim()) values.push({ label: "fbclid", value: "sí" });

    const status = t.meta_match_status === "manual" || t.meta_match_status === "ignored" ? t.meta_match_status : "unmatched";
    const adKey = input.utmContent ? metaNameKey(decodeUtm(input.utmContent)) : "";
    const campaignKey = input.utmCampaign ? metaNameKey(decodeUtm(input.utmCampaign)) : "";
    const reasons =
      status === "unmatched"
        ? describeMatchReasons(t.meta_match_reason, {
            adId: input.adId,
            adsetId: input.adsetId,
            campaignId: input.campaignId,
            utmContent: input.utmContent ? (decodeUtm(input.utmContent) ?? undefined) : undefined,
            utmCampaign: input.utmCampaign ? (decodeUtm(input.utmCampaign) ?? undefined) : undefined,
            count: (t.meta_match_reason ?? "").includes("ambiguous_campaign_name") ? counts.campaigns[campaignKey] : counts.ads[adKey],
          })
        : [];

    const origin = [sourceLabel(t.source), ORIGIN_LABELS[t.origin as TouchOrigin] ?? t.origin].filter(Boolean).join(" · ");

    return {
      touchId: t.id,
      contactId: t.contact_id,
      contactName: params.contactNames[t.contact_id] || "Sin nombre",
      when: shortDate(t.occurred_at, params.timeZone),
      origin,
      values,
      reasons,
      status,
      method: status === "manual" ? describeMatchMethod("manual") : null,
      chosen: status === "manual" ? { adId: t.meta_ad_id, adsetId: t.meta_adset_id, campaignId: t.meta_campaign_id } : null,
    };
  });
}

/** Desde cuando se mira: `days` dias antes de `now`. */
export function sinceFor(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
