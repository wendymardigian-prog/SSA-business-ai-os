/**
 * La gemela en TypeScript de `resolve_meta_match`: corre los casos compartidos con la funcion SQL.
 * (Los mismos casos corren contra la base en scripts/verify-ads-attribution.mjs.)
 */
import { describe, expect, it } from "vitest";
import cases from "./meta-match.cases.json";
import { decodeUtm, resolveMetaMatch, touchHasMetaData, touchMetaInput, type MetaCatalog, type MetaMatchInput } from "./meta-match";
import { metaNameKey } from "@/lib/meta/name-key";

const catalog: MetaCatalog = {
  campaigns: cases.catalog.campaigns.map((c) => ({ campaignId: c.campaignId, nameKey: metaNameKey(c.name) })),
  adsets: cases.catalog.adsets.map((s) => ({ adsetId: s.adsetId, campaignId: s.campaignId })),
  ads: cases.catalog.ads.map((a) => ({ adId: a.adId, adsetId: a.adsetId, campaignId: a.campaignId, nameKey: metaNameKey(a.name) })),
};

describe("resolveMetaMatch (casos compartidos con la funcion SQL)", () => {
  it.each(cases.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(resolveMetaMatch(c.input as MetaMatchInput, catalog)).toEqual(c.expected);
  });

  it("hay casos para los tres estados y para cada motivo", () => {
    const reasons = new Set(cases.cases.map((c) => c.expected.reason));
    for (const reason of ["id_not_in_catalog", "name_not_found", "ambiguous_ad_name", "ambiguous_campaign_name", "fbclid_only", "inconsistent_campaign"]) {
      expect(reasons.has(reason), reason).toBe(true);
    }
    expect(new Set(cases.cases.map((c) => c.expected.status))).toEqual(new Set(["none", "matched", "unmatched"]));
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

  it("una reserva con utm_content SI cuenta (agenda, formulario, webhook, importado, manual)", () => {
    for (const origin of ["booking", "form", "webhook", "import", "manual"]) {
      expect(touchHasMetaData({ origin, contentLabel: "Oferta Única" }), origin).toBe(true);
    }
    expect(resolveMetaMatch(touchMetaInput({ origin: "booking", contentLabel: "Oferta Única" }), catalog)).toMatchObject({ status: "matched", adId: "3003", method: "utm_content_name" });
  });

  it("un DM que viene de un anuncio (con ad_id) usa tambien el titulo como nombre", () => {
    const touch = { origin: "dm", adId: "999", contentLabel: "Oferta Única" };
    expect(touchHasMetaData(touch)).toBe(true);
    expect(resolveMetaMatch(touchMetaInput(touch), catalog)).toMatchObject({ status: "matched", adId: "3003", method: "utm_content_name", reason: null });
  });

  it("los ids y el fbclid siempre cuentan, venga de donde venga", () => {
    expect(touchHasMetaData({ origin: "comment", adId: "3003" })).toBe(true);
    expect(touchHasMetaData({ origin: "dm", fbclid: "IwAR" })).toBe(true);
    expect(touchHasMetaData({ origin: "comment" })).toBe(false);
  });
});
