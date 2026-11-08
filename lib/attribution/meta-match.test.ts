/**
 * La gemela en TypeScript de `resolve_meta_match`: corre los casos compartidos con la funcion SQL.
 * (Los mismos casos corren contra la base en scripts/verify-ads-attribution.mjs.)
 */
import { describe, expect, it } from "vitest";
import cases from "./meta-match.cases.json";
import {
  decodeUtm,
  metaNameTokens,
  metaRuleKey,
  resolveMetaMatch,
  tokensQualify,
  touchHasMetaData,
  touchMetaInput,
  touchUtmId,
  touchUtmMedium,
  type MetaCatalog,
  type MetaMatchInput,
} from "./meta-match";
import { metaNameKey } from "@/lib/meta/name-key";

const catalog: MetaCatalog = {
  campaigns: cases.catalog.campaigns.map((c) => ({ campaignId: c.campaignId, nameKey: metaNameKey(c.name) })),
  adsets: cases.catalog.adsets.map((s) => ({ adsetId: s.adsetId, campaignId: s.campaignId })),
  ads: cases.catalog.ads.map((a) => ({ adId: a.adId, adsetId: a.adsetId, campaignId: a.campaignId, nameKey: metaNameKey(a.name) })),
  rules: cases.catalog.rules.map((r) => ({
    campaignKey: metaRuleKey(r.utmCampaign),
    contentKey: metaRuleKey(r.utmContent),
    termKey: metaRuleKey(r.utmTerm),
    action: r.action as "link" | "ignore",
    adId: r.adId,
    adsetId: r.adsetId,
    campaignId: r.campaignId,
  })),
};

describe("resolveMetaMatch (casos compartidos con la funcion SQL)", () => {
  it.each(cases.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(resolveMetaMatch(c.input as MetaMatchInput, catalog)).toEqual(c.expected);
  });

  it("hay casos para cada metodo nuevo (00318): regla, nombre exacto y parecido", () => {
    const methods = new Set(cases.cases.map((c) => c.expected.method));
    for (const method of [
      "rule",
      "utm_campaign_name",
      "utm_content_name",
      "utm_campaign_similar",
      "utm_content_similar_adset",
      "utm_content_similar_campaign",
      "utm_content_name_adset",
      "utm_content_name_campaign",
      "adset_single_ad",
    ]) {
      expect(methods.has(method), method).toBe(true);
    }
  });

  it("hay casos para los cuatro estados y para cada motivo", () => {
    const reasons = new Set(cases.cases.map((c) => c.expected.reason));
    for (const reason of ["id_not_in_catalog", "name_without_id", "name_not_found", "ambiguous_ad_name", "ambiguous_campaign_name", "fbclid_only", "inconsistent_campaign"]) {
      expect(reasons.has(reason), reason).toBe(true);
    }
    expect(new Set(cases.cases.map((c) => c.expected.status))).toEqual(new Set(["none", "matched", "unmatched", "ignored"]));
  });
});

describe("las palabras de un nombre (parecido)", () => {
  it("parte por todo lo que no es letra ni numero y saca el relleno", () => {
    expect(metaNameTokens("ad-n4-techo")).toEqual(["n4", "techo"]);
    expect(metaNameTokens("N4 · El techo")).toEqual(["n4", "techo"]);
    expect(metaNameTokens("S2 · Directo + método")).toEqual(["directo", "metodo", "s2"]);
    expect(metaNameTokens("Campaña  Octubre")).toEqual(["octubre"]);
    expect(metaNameTokens(null)).toEqual([]);
  });
  it("alcanzan dos palabras o un codigo con letras y numeros", () => {
    expect(tokensQualify(["n4"])).toBe(true);
    expect(tokensQualify(["directo", "corto"])).toBe(true);
    expect(tokensQualify(["costo"])).toBe(false);
    expect(tokensQualify(["2026"])).toBe(false);
    expect(tokensQualify([])).toBe(false);
  });
  it("la clave de una regla: decodificada, recortada, sin tildes ni mayusculas", () => {
    expect(metaRuleKey(" Promo%205 ")).toBe("promo 5");
    expect(metaRuleKey("AD-X9")).toBe("ad-x9");
    expect(metaRuleKey(null)).toBe("");
  });
});

describe("decodeUtm", () => {
  it("decodifica %XX y +", () => {
    expect(decodeUtm("Video%20Testimonio")).toBe("Video Testimonio");
    expect(decodeUtm("video+testimonio")).toBe("video testimonio");
    expect(decodeUtm("%C3%9Anica")).toBe("Única");
  });
  it("lo que no se puede decodificar se deja como llego", () => {
    expect(decodeUtm("100%")).toBe("100%");
    expect(decodeUtm("%E9")).toBe("%E9");
    expect(decodeUtm("%zz")).toBe("%zz");
  });
  it("null sigue siendo null", () => {
    expect(decodeUtm(null)).toBeNull();
    expect(decodeUtm(undefined)).toBeNull();
  });
});

describe("touchMetaInput / touchHasMetaData (la regla de la 00194)", () => {
  it("un comentario organico con titulo de publicacion NO tiene datos de Meta", () => {
    const touch = { origin: "comment", contentLabel: "Todo el mundo habla de la inteligencia artificial", campaign: null };
    expect(touchHasMetaData(touch)).toBe(false);
    expect(resolveMetaMatch(touchMetaInput(touch), catalog).status).toBe("none");
  });

  it("un DM organico con el titulo de una historia tampoco", () => {
    expect(touchHasMetaData({ origin: "dm", contentLabel: "Oferta Única", term: "x" })).toBe(false);
  });

  it("una reserva con utm_content de Meta SI cuenta (agenda, formulario, webhook, importado, manual)", () => {
    for (const origin of ["booking", "form", "webhook", "import", "manual"]) {
      expect(touchHasMetaData({ origin, source: "meta", contentLabel: "Oferta Única" }), origin).toBe(true);
      expect(touchHasMetaData({ origin, utmMedium: "paid", contentLabel: "Oferta Única" }), `${origin} + paid`).toBe(true);
    }
    // Sin fuente ni medium (00318): no se sabe si es un anuncio, y no ensucia «Sin vincular».
    expect(touchHasMetaData({ origin: "booking", contentLabel: "Oferta Única" })).toBe(false);
    expect(resolveMetaMatch(touchMetaInput({ origin: "booking", source: "meta", contentLabel: "Oferta Única" }), catalog)).toMatchObject({ status: "unmatched", reason: "name_without_id" });
    expect(resolveMetaMatch(touchMetaInput({ origin: "booking", campaignId: "1001", contentLabel: "Oferta Única" }), catalog)).toMatchObject({ status: "matched", adId: "3003", method: "utm_content_name_campaign" });
  });

  it("un DM con un ad_id que no esta en el catalogo no se vincula por el titulo", () => {
    const touch = { origin: "dm", adId: "999", contentLabel: "Oferta Única" };
    expect(touchHasMetaData(touch)).toBe(true);
    expect(resolveMetaMatch(touchMetaInput(touch), catalog)).toMatchObject({ status: "unmatched", reason: "id_not_in_catalog" });
  });

  it("una fuente que no es de Meta con UTMs de texto no tiene datos de Meta", () => {
    const touch = { origin: "form", source: "whatsapp", campaign: "grupo-editor" };
    expect(touchHasMetaData(touch)).toBe(false);
    expect(resolveMetaMatch(touchMetaInput(touch), catalog).status).toBe("none");
  });

  it("esa misma fuente con un UTM numerico cuenta: puede ser un id", () => {
    const touch = { origin: "import", source: "calculadora_hero", campaign: "1001" };
    expect(touchHasMetaData(touch)).toBe(true);
    expect(resolveMetaMatch(touchMetaInput(touch), catalog)).toMatchObject({ status: "matched", campaignId: "1001", method: "utm_campaign_id" });
  });

  it("«meta» y «facebook» cuentan solas; «ig», «instagram» o sin fuente necesitan un medium pago (00318)", () => {
    for (const source of ["meta", "Facebook"]) expect(touchHasMetaData({ origin: "form", source, campaign: "clase" }), source).toBe(true);
    for (const source of ["instagram", "ig", "fb", "web", null, ""]) {
      expect(touchHasMetaData({ origin: "form", source, campaign: "clase" }), String(source)).toBe(false);
      expect(touchHasMetaData({ origin: "form", source, utmMedium: "paid", campaign: "clase" }), `${source} + paid`).toBe(true);
    }
  });

  it("un medium organico gana: el link de la bio no es un anuncio aunque traiga fbclid", () => {
    expect(touchHasMetaData({ origin: "form", source: "ig", utmMedium: "social", contentLabel: "link_in_bio", fbclid: "IwAR" })).toBe(false);
    expect(touchHasMetaData({ origin: "form", source: "meta", utmMedium: "email", campaign: "clase" })).toBe(false);
    expect(touchHasMetaData({ origin: "form", source: "instagram", campaign: "new-follow" })).toBe(false);
    expect(resolveMetaMatch(touchMetaInput({ origin: "form", source: "ig", utmMedium: "social", contentLabel: "link_in_bio" }), catalog).status).toBe("none");
  });

  it("un anuncio con etiquetas propias se vincula por parecido desde el toque", () => {
    const touch = { origin: "form", source: "meta", utmMedium: "paid", campaign: "promo-5-mayo", contentLabel: "ad-f1-costo", fbclid: "IwAR" };
    expect(resolveMetaMatch(touchMetaInput(touch), catalog)).toMatchObject({ status: "matched", adId: "3007", method: "utm_content_similar_campaign" });
  });

  it("un utm_id numerico es el id de la campaña, salvo en una fuente que no es de Meta", () => {
    expect(resolveMetaMatch(touchMetaInput({ origin: "form", source: "meta", utmId: "1001", contentLabel: "Oferta Única" }), catalog)).toMatchObject({ adId: "3003", campaignId: "1001", method: "utm_content_name_campaign" });
    expect(touchMetaInput({ origin: "form", source: "meta", utmId: "abc" }).campaignId ?? null).toBeNull();
    expect(touchMetaInput({ origin: "form", source: "google", utmId: "1001" }).campaignId ?? null).toBeNull();
    expect(touchMetaInput({ origin: "form", source: "meta", campaignId: "1002", utmId: "1001" }).campaignId).toBe("1002");
  });

  it("touchUtmId lee donde lo guarda un formulario y donde lo guarda una reunion", () => {
    expect(touchUtmId({ utm_id: "1" })).toBe("1");
    expect(touchUtmId({ utm: { utm_id: "2" } })).toBe("2");
    expect(touchUtmId({ utm: {} })).toBeNull();
    expect(touchUtmId(null)).toBeNull();
  });

  it("touchUtmMedium lee donde lo guarda un formulario o una reunion", () => {
    expect(touchUtmMedium({ utm: { utm_medium: " paid " } })).toBe("paid");
    expect(touchUtmMedium({ utm_medium: "social" })).toBe("social");
    expect(touchUtmMedium({ utm: {} })).toBeNull();
    expect(touchUtmMedium(null)).toBeNull();
  });

  it("los ids siempre cuentan, venga de donde venga; el fbclid solo, no (00318)", () => {
    expect(touchHasMetaData({ origin: "comment", adId: "3003" })).toBe(true);
    expect(touchHasMetaData({ origin: "dm", fbclid: "IwAR" })).toBe(false);
    expect(touchHasMetaData({ origin: "form", source: "web", fbclid: "IwAR" })).toBe(false);
    expect(touchMetaInput({ origin: "form", source: "meta", campaign: "1001", fbclid: "IwAR" }).fbclid).toBeNull();
    expect(touchHasMetaData({ origin: "comment" })).toBe(false);
  });
});
