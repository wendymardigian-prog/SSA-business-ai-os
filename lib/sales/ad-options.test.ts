import { describe, expect, it } from "vitest";
import { buildAdOption } from "./ad-options";

describe("buildAdOption", () => {
  it("un anuncio dice Campaña › Conjunto › Anuncio y trae los tres ids", () => {
    expect(
      buildAdOption({ level: "ad", ad: { id: "3", name: "Video 1" }, adset: { id: "2", name: "Lookalike" }, campaign: { id: "1", name: "Octubre" } }),
    ).toEqual({ key: "ad:3", level: "ad", adId: "3", adsetId: "2", campaignId: "1", label: "Octubre › Lookalike › Video 1" });
  });

  it("un conjunto trae su campaña y no tiene anuncio", () => {
    expect(buildAdOption({ level: "adset", adset: { id: "2", name: "Lookalike" }, campaign: { id: "1", name: "Octubre" } })).toMatchObject({
      adId: null,
      adsetId: "2",
      campaignId: "1",
      label: "Octubre › Lookalike",
    });
  });

  it("una campaña sola", () => {
    expect(buildAdOption({ level: "campaign", campaign: { id: "1", name: "Octubre" } })).toMatchObject({ adId: null, adsetId: null, campaignId: "1", label: "Octubre" });
  });

  it("sin nombre de Meta se muestra el id, sin inventar un nombre", () => {
    expect(buildAdOption({ level: "ad", ad: { id: "3", name: null }, adset: null, campaign: null }).label).toBe("Anuncio 3");
    expect(buildAdOption({ level: "ad", ad: { id: "3", name: "  " }, adset: { id: "2", name: null }, campaign: null }).label).toBe("Conjunto 2 › Anuncio 3");
  });
});
