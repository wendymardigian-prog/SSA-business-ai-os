import { describe, expect, it } from "vitest";
import { describeMatchMethod, describeMatchReason, describeMatchReasons } from "./meta-match-reasons";

describe("describeMatchReason", () => {
  it("id_not_in_catalog dice cual id y que puede ser", () => {
    expect(describeMatchReason("id_not_in_catalog", { adId: "1202345" })).toBe(
      "El anuncio 1202345 no está en la cuenta: puede ser de otra cuenta o muy nuevo (se vuelve a intentar en cada sincronización).",
    );
    expect(describeMatchReason("id_not_in_catalog", { campaignId: "55" })).toContain("La campaña 55");
    expect(describeMatchReason("id_not_in_catalog")).toContain("El id que trae no está");
  });

  it("ambiguous_ad_name cuenta los anuncios cuando se sabe", () => {
    const text = describeMatchReason("ambiguous_ad_name", { utmContent: "Video Testimonio", count: 3 });
    expect(text).toContain("Hay 3 anuncios con el nombre «Video Testimonio»");
    expect(describeMatchReason("ambiguous_ad_name")).toContain("Hay varios anuncios");
  });

  it("ambiguous_campaign_name y name_not_found", () => {
    expect(describeMatchReason("ambiguous_campaign_name", { utmCampaign: "Retargeting", count: 2 })).toContain("Hay 2 campañas con el nombre «Retargeting»");
    expect(describeMatchReason("name_not_found", { utmContent: "Fantasma" })).toContain("«Fantasma» no coincide");
    expect(describeMatchReason("name_not_found", { utmCampaign: "Otra" })).toContain("«Otra» no coincide");
    expect(describeMatchReason("name_not_found")).toContain("no coincide con ningún anuncio");
  });

  it("fbclid_only e inconsistent_campaign", () => {
    expect(describeMatchReason("fbclid_only")).toBe("Solo trae el id de clic de Facebook: no alcanza para saber el anuncio.");
    expect(describeMatchReason("inconsistent_campaign")).toContain("se usó la campaña del anuncio");
  });

  it("un codigo que no se conoce se dice tal cual", () => {
    expect(describeMatchReason("algo_nuevo")).toBe("algo_nuevo");
  });
});

describe("describeMatchReasons", () => {
  it("separa los motivos de una lista con comas", () => {
    expect(describeMatchReasons("inconsistent_campaign,id_not_in_catalog", { adId: "9" })).toHaveLength(2);
  });
  it("sin motivo, nada", () => {
    expect(describeMatchReasons(null)).toEqual([]);
    expect(describeMatchReasons("")).toEqual([]);
  });
});

describe("describeMatchMethod", () => {
  it("dice como se hallo", () => {
    expect(describeMatchMethod("ad_id")).toBe("por el id del anuncio");
    expect(describeMatchMethod("manual")).toBe("a mano");
    expect(describeMatchMethod("utm_content_name_campaign")).toContain("nombre del anuncio y su campaña");
  });
  it("un metodo desconocido o vacio no inventa nada", () => {
    expect(describeMatchMethod("otro")).toBeNull();
    expect(describeMatchMethod(null)).toBeNull();
  });
});
