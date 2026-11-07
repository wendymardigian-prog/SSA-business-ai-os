/**
 * Lo que muestra «Sin vincular» (Extra L, AT3, F29; agrupado desde la 00318): los toques que traen datos de un
 * anuncio y no se pudieron vincular, con lo que llego y el MOTIVO en palabras.
 *
 * Desde la 00318 la pantalla muestra GRUPOS: los toques con los mismos UTMs van juntos, porque se vinculan juntos
 * (una regla vale para todos). Cada grupo dice cuantas personas trae, cuantas agendaron o compraron y cuantas
 * lo tienen como primer o ultimo toque, y se ordena por eso.
 *
 * Todo lo que decide que se muestra vive aca, puro y con test; la pantalla solo lo compone.
 */

import { decodeUtm, isReviewMethod, metaNameTokens, metaRuleKey, touchMetaInput, touchUtmId, touchUtmMedium, type TouchForMatch } from "@/lib/attribution/meta-match";
import { describeMatchReasons, describeMatchMethod } from "@/lib/attribution/meta-match-reasons";
import { metaNameKey } from "@/lib/meta/name-key";
import { ORIGIN_LABELS, sourceLabel, type TouchOrigin } from "@/lib/contacts/taxonomy";
import { shortDate } from "@/lib/contacts/attribution-view";
import { EMPTY_META_NAMES, type MetaNames } from "./meta-names";

/** Los dias que se pueden mirar hacia atras. */
export const UNLINKED_DAYS = [30, 90, 180, 365] as const;
export const DEFAULT_UNLINKED_DAYS = 90;
export const UNLINKED_PAGE_SIZE = 25;

export type UnlinkedView = "sin-vincular" | "revisar" | "sin-anuncio" | "reglas" | "manuales";
const VIEWS: readonly UnlinkedView[] = ["sin-vincular", "revisar", "sin-anuncio", "reglas", "manuales"];

export function parseDays(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (UNLINKED_DAYS as readonly number[]).includes(n) ? n : DEFAULT_UNLINKED_DAYS;
}

export function parseView(value: string | string[] | undefined): UnlinkedView {
  const v = Array.isArray(value) ? value[0] : value;
  return VIEWS.includes(v as UnlinkedView) ? (v as UnlinkedView) : "sin-vincular";
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
  dedupe_key?: string | null;
  raw?: unknown;
}

const forMatch = (t: UnlinkedTouch): TouchForMatch => ({
  origin: t.origin,
  source: t.source,
  medium: t.medium,
  utmMedium: touchUtmMedium(t.raw),
  utmId: touchUtmId(t.raw),
  adId: t.ad_id,
  adsetId: t.adset_id,
  campaignId: t.campaign_id,
  campaign: t.campaign,
  contentLabel: t.content_label,
  term: t.term,
  fbclid: t.fbclid,
});

/** La respuesta o la reunión de la que salió un toque. Un formulario guarda su id en `raw.source_id`. */
export function touchSourceLink(touch: Pick<UnlinkedTouch, "dedupe_key" | "raw">): { href: string; label: string } | null {
  const key = touch.dedupe_key ?? "";
  if (key.startsWith("booking:")) return { href: `/dashboard/agenda?agenda=${key.slice("booking:".length)}`, label: "Ver la reunión" };
  // @plantilla-desde(formularios)
  if (key.startsWith("form:")) {
    const formId = (touch.raw as { source_id?: unknown } | null | undefined)?.source_id;
    if (typeof formId === "string" && formId) return { href: `/dashboard/formularios/${formId}/respuestas/${key.slice("form:".length)}`, label: "Ver la respuesta" };
  }
  // @plantilla-hasta(formularios)
  return null;
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
  /** `matched`: vinculado solo (le falta el anuncio, o salio por parecido y va a revisar). */
  status: "unmatched" | "manual" | "ignored" | "matched";
  /** Como se vinculo (lo manual lo dice). */
  method: string | null;
  /** A qué quedó vinculado: «Campaña › Conjunto › Anuncio», con el nombre o, si no se puede ver, el id. */
  linked: string | null;
  /** La respuesta o la reunión de origen. */
  sourceHref: string | null;
  sourceLabel: string | null;
}

/** Las claves de nombre que hace falta contar para los toques con un motivo de nombre ambiguo. */
export function ambiguousKeys(touches: UnlinkedTouch[]): { ads: string[]; campaigns: string[] } {
  const ads = new Set<string>();
  const campaigns = new Set<string>();
  for (const t of touches) {
    const reason = t.meta_match_reason ?? "";
    const input = touchMetaInput(forMatch(t));
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
  /** Los nombres del catálogo; sin ellos, los ids. */
  names?: MetaNames;
}): UnlinkedRow[] {
  const names = params.names ?? EMPTY_META_NAMES;
  const counts = params.counts ?? { ads: {}, campaigns: {} };

  return params.touches.map((t) => {
    // Lo que se muestra es lo que de verdad cuenta como dato de Meta (la regla de la 00194).
    const input = touchMetaInput(forMatch(t));

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
    // El fbclid solo no vincula nada (00318), pero se muestra que vino: nunca su valor.
    if ((t.fbclid ?? "").trim()) values.push({ label: "fbclid", value: "sí" });

    const status = t.meta_match_status === "manual" || t.meta_match_status === "ignored" || t.meta_match_status === "matched" ? t.meta_match_status : "unmatched";
    const fromRule = t.meta_match_method === "rule";
    const adKey = input.utmContent ? metaNameKey(decodeUtm(input.utmContent)) : "";
    const campaignKey = input.utmCampaign ? metaNameKey(decodeUtm(input.utmCampaign)) : "";
    const reasons =
      status === "unmatched" || status === "matched"
        ? describeMatchReasons(t.meta_match_reason, {
            adId: input.adId,
            adsetId: input.adsetId,
            campaignId: input.campaignId,
            utmContent: input.utmContent ? (decodeUtm(input.utmContent) ?? undefined) : undefined,
            utmCampaign: input.utmCampaign ? (decodeUtm(input.utmCampaign) ?? undefined) : undefined,
            count: (t.meta_match_reason ?? "").includes("ambiguous_campaign_name") ? counts.campaigns[campaignKey] : counts.ads[adKey],
          })
        : [];

    const source = touchSourceLink(t);
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
      method: status === "manual" ? describeMatchMethod("manual") : fromRule || isReviewMethod(t.meta_match_method) ? describeMatchMethod(t.meta_match_method) : null,
      linked: status === "ignored" || status === "unmatched" ? null : linkedLine(t, names),
      sourceHref: source?.href ?? null,
      sourceLabel: source?.label ?? null,
    };
  });
}

function linkedLine(t: UnlinkedTouch, names: MetaNames): string | null {
  const line = [
    t.meta_campaign_id ? (names.campaigns[t.meta_campaign_id] ?? `Campaña ${t.meta_campaign_id}`) : null,
    t.meta_adset_id ? (names.adsets[t.meta_adset_id] ?? `Conjunto ${t.meta_adset_id}`) : null,
    t.meta_ad_id ? (names.ads[t.meta_ad_id] ?? `Anuncio ${t.meta_ad_id}`) : null,
  ]
    .filter(Boolean)
    .join(" › ");
  return line || null;
}

/** Desde cuando se mira: `days` dias antes de `now`. */
export function sinceFor(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

// ════════════════════════════════════════════════════════════════════════════
// Grupos (00318)
// ════════════════════════════════════════════════════════════════════════════

export const UNLINKED_GROUPS_PER_PAGE = 25;

/** Lo que se sabe de cada contacto para medir el impacto de un grupo. */
export interface ContactFacts {
  hasBooking: boolean;
  hasSale: boolean;
  /** El id del primer y del ultimo toque del contacto (el orden de `refresh_contact_attribution`). */
  firstTouchId: string | null;
  lastTouchId: string | null;
}

export interface GroupPerson {
  touchId: string;
  contactId: string;
  contactName: string;
  when: string;
  origin: string;
  sourceHref: string | null;
  sourceLabel: string | null;
  isFirstTouch: boolean;
  isLastTouch: boolean;
  hasBooking: boolean;
  hasSale: boolean;
}

/** Los UTMs con los que se crea una regla para el grupo (decodificados). */
export interface GroupRuleInput {
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}

export interface UnlinkedGroup {
  key: string;
  status: UnlinkedRow["status"];
  /** «Por parecido», «por una regla», «a mano»... */
  method: string | null;
  values: UnlinkedRow["values"];
  reasons: string[];
  linked: string | null;
  /** A que quedo vinculado, en ids (para «Confirmar»). */
  linkedIds: { adId: string | null; adsetId: string | null; campaignId: string | null } | null;
  /** null: el grupo no tiene UTMs (solo ids que no estan en el catalogo) y se vincula toque por toque. */
  rule: GroupRuleInput | null;
  /** Con que arranca el buscador de «Vincular»: el codigo o la palabra mas distintiva del UTM. */
  search: string;
  utmSource: string | null;
  utmMedium: string | null;
  touchIds: string[];
  people: GroupPerson[];
  peopleCount: number;
  withBooking: number;
  withSale: number;
  firstCount: number;
  lastCount: number;
  /** El toque mas reciente (ISO), para desempatar el orden. */
  lastAt: string;
}

/**
 * Con que arranca el buscador: un codigo con letras y numeros («n4») si hay, si no la palabra mas larga.
 * El nombre en Meta casi nunca es el UTM entero, asi que buscar «ad-n4-techo» no encontraria nada.
 */
export function pickerSeed(value: string | null | undefined): string {
  const tokens = metaNameTokens(decodeUtm(value ?? null));
  const code = tokens.find((w) => /[a-z]/.test(w) && /[0-9]/.test(w));
  if (code) return code;
  return [...tokens].sort((a, b) => b.length - a.length)[0] ?? "";
}

/**
 * Agrupa las filas por lo que se vincula junto: el estado, los UTMs (por su clave de regla) y lo que ya tiene
 * vinculado. Ordena por impacto: ventas, agendas, personas y despues lo mas reciente.
 */
export function groupUnlinked(params: {
  touches: UnlinkedTouch[];
  rows: UnlinkedRow[];
  facts: Record<string, ContactFacts>;
}): UnlinkedGroup[] {
  const rowById = new Map(params.rows.map((r) => [r.touchId, r]));
  const groups = new Map<string, UnlinkedGroup>();

  for (const t of params.touches) {
    const row = rowById.get(t.id);
    if (!row) continue;
    const input = touchMetaInput(forMatch(t));
    const ck = metaRuleKey(input.utmCampaign);
    const kk = metaRuleKey(input.utmContent);
    const tk = metaRuleKey(input.utmTerm);
    const key = [
      row.status,
      t.meta_match_method === "rule" ? "rule" : isReviewMethod(t.meta_match_method) ? "review" : "",
      ck,
      kk,
      tk,
      ck || kk || tk ? "" : [input.adId, input.adsetId, input.campaignId].map((v) => (v ?? "").trim()).join("/"),
      t.meta_ad_id ?? "",
      t.meta_adset_id ?? "",
      t.meta_campaign_id ?? "",
    ].join("|");

    const facts = params.facts[t.contact_id] ?? { hasBooking: false, hasSale: false, firstTouchId: null, lastTouchId: null };
    const person: GroupPerson = {
      touchId: t.id,
      contactId: t.contact_id,
      contactName: row.contactName,
      when: row.when,
      origin: row.origin,
      sourceHref: row.sourceHref,
      sourceLabel: row.sourceLabel,
      isFirstTouch: facts.firstTouchId === t.id,
      isLastTouch: facts.lastTouchId === t.id,
      hasBooking: facts.hasBooking,
      hasSale: facts.hasSale,
    };

    let group = groups.get(key);
    if (!group) {
      const decoded = (v: string | null | undefined) => (v ? (decodeUtm(v)?.trim() ?? null) || null : null);
      group = {
        key,
        status: row.status,
        method: row.method,
        values: row.values,
        reasons: row.reasons,
        linked: row.linked,
        linkedIds: t.meta_ad_id || t.meta_adset_id || t.meta_campaign_id ? { adId: t.meta_ad_id, adsetId: t.meta_adset_id, campaignId: t.meta_campaign_id } : null,
        rule: ck || kk || tk ? { utmCampaign: decoded(input.utmCampaign), utmContent: decoded(input.utmContent), utmTerm: decoded(input.utmTerm) } : null,
        search: pickerSeed(input.utmContent) || pickerSeed(input.utmCampaign),
        utmSource: t.source || null,
        utmMedium: touchUtmMedium(t.raw),
        touchIds: [],
        people: [],
        peopleCount: 0,
        withBooking: 0,
        withSale: 0,
        firstCount: 0,
        lastCount: 0,
        lastAt: t.occurred_at,
      };
      groups.set(key, group);
    }
    group.touchIds.push(t.id);
    group.people.push(person);
    if (t.occurred_at > group.lastAt) group.lastAt = t.occurred_at;
  }

  for (const group of groups.values()) {
    const contacts = new Map<string, GroupPerson[]>();
    for (const p of group.people) contacts.set(p.contactId, [...(contacts.get(p.contactId) ?? []), p]);
    group.peopleCount = contacts.size;
    group.withBooking = [...contacts.values()].filter((ps) => ps[0].hasBooking).length;
    group.withSale = [...contacts.values()].filter((ps) => ps[0].hasSale).length;
    group.firstCount = [...contacts.values()].filter((ps) => ps.some((p) => p.isFirstTouch)).length;
    group.lastCount = [...contacts.values()].filter((ps) => ps.some((p) => p.isLastTouch)).length;
  }

  return [...groups.values()].sort(
    (a, b) => b.withSale - a.withSale || b.withBooking - a.withBooking || b.peopleCount - a.peopleCount || b.lastAt.localeCompare(a.lastAt),
  );
}

/** El primer y el ultimo toque de cada contacto, con el mismo orden que `refresh_contact_attribution`. */
export function firstAndLastTouch(
  touches: Array<{ id: string; contact_id: string; occurred_at: string; created_at: string }>,
): Record<string, { firstTouchId: string; lastTouchId: string }> {
  const byContact = new Map<string, typeof touches>();
  for (const t of touches) byContact.set(t.contact_id, [...(byContact.get(t.contact_id) ?? []), t]);
  const out: Record<string, { firstTouchId: string; lastTouchId: string }> = {};
  for (const [contactId, list] of byContact) {
    const sorted = [...list].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    out[contactId] = { firstTouchId: sorted[0].id, lastTouchId: sorted[sorted.length - 1].id };
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// Reglas
// ════════════════════════════════════════════════════════════════════════════

export interface MetaRuleRecord {
  id: string;
  campaign_key: string;
  content_key: string;
  term_key: string;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  action: "link" | "ignore";
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  origin: "manual" | "confirmed" | "ai";
  created_at: string;
}

export interface RuleRow {
  id: string;
  values: Array<{ label: string; value: string }>;
  action: "link" | "ignore";
  /** «Campaña › Conjunto › Anuncio» o «No es un anuncio». */
  target: string;
  origin: string;
  when: string;
  /** Cuantos toques usan la regla hoy. */
  touches: number;
}

const RULE_ORIGIN: Record<MetaRuleRecord["origin"], string> = {
  manual: "Vinculado a mano",
  confirmed: "Confirmado de una sugerencia",
  ai: "Propuesto por la IA y confirmado",
};

/** La clave de una regla, para contar los toques que la usan. */
export const ruleKeyOf = (campaign: string | null, content: string | null, term: string | null) =>
  [metaRuleKey(campaign), metaRuleKey(content), metaRuleKey(term)].join("|");

export function buildRuleRows(params: { rules: MetaRuleRecord[]; names?: MetaNames; usage: Record<string, number>; timeZone?: string }): RuleRow[] {
  const names = params.names ?? EMPTY_META_NAMES;
  return params.rules.map((r) => {
    const values: RuleRow["values"] = [];
    if (r.utm_campaign) values.push({ label: "utm_campaign", value: r.utm_campaign });
    if (r.utm_content) values.push({ label: "utm_content", value: r.utm_content });
    if (r.utm_term) values.push({ label: "utm_term", value: r.utm_term });
    const target =
      r.action === "ignore"
        ? "No es un anuncio"
        : (linkedLine({ meta_ad_id: r.ad_id, meta_adset_id: r.adset_id, meta_campaign_id: r.campaign_id } as UnlinkedTouch, names) ?? "—");
    return {
      id: r.id,
      values,
      action: r.action,
      target,
      origin: RULE_ORIGIN[r.origin] ?? r.origin,
      when: shortDate(r.created_at, params.timeZone),
      touches: params.usage[[r.campaign_key, r.content_key, r.term_key].join("|")] ?? 0,
    };
  });
}

/** Los parametros de URL para pegar en Meta: con ellos cada visita trae los ids y se vincula sola. */
export const META_URL_PARAMS =
  "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_id={{campaign.id}}&ad_id={{ad.id}}&adset_id={{adset.id}}&campaign_id={{campaign.id}}";
