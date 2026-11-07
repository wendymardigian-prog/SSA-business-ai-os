import { describe, expect, it } from "vitest";
import { drillTargets, levelToParams, parseLevel } from "./ads-drill";

const params = (query: string) => new URLSearchParams(query);

describe("parseLevel", () => {
  it("sin nada, son las campañas", () => {
    expect(parseLevel(params(""))).toBe("campaign");
  });

  it("lee la pestaña y descarta lo que no conoce", () => {
    expect(parseLevel(params("nivel=adsets"))).toBe("adset");
    expect(parseLevel(params("nivel=anuncios"))).toBe("ad");
    expect(parseLevel(params("nivel=cualquiera"))).toBe("campaign");
  });
});

describe("levelToParams", () => {
  it("no toca la cuenta, el periodo ni los filtros", () => {
    expect(levelToParams(params("cuenta=act_1&range=7d&campana=11"), "ad").toString()).toBe("cuenta=act_1&range=7d&campana=11&nivel=anuncios");
  });

  it("Campañas deja la URL sin nivel", () => {
    expect(levelToParams(params("cuenta=act_1&nivel=anuncios"), "campaign").toString()).toBe("cuenta=act_1");
  });

  it("ida y vuelta da lo mismo", () => {
    expect(parseLevel(levelToParams(params(""), "adset"))).toBe("adset");
  });
});

describe("drillTargets: el menu de una fila", () => {
  const labels = (level: "campaign" | "adset" | "ad") => drillTargets(level, { objectId: "9", campaignId: "11" }).map((t) => t.label);

  it("una campaña baja a sus AdSets o a sus anuncios", () => {
    expect(labels("campaign")).toEqual(["Ver AdSets", "Ver anuncios", "Abrir el detalle de la campaña"]);
    expect(drillTargets("campaign", { objectId: "9", campaignId: null })[1]).toMatchObject({ level: "ad", campaignIds: ["9"], adsetIds: [] });
  });

  it("un AdSet baja a sus anuncios y conserva su campaña", () => {
    expect(labels("adset")).toEqual(["Ver anuncios", "Abrir el detalle del AdSet"]);
    expect(drillTargets("adset", { objectId: "9", campaignId: "11" })[0]).toMatchObject({ level: "ad", campaignIds: ["11"], adsetIds: ["9"] });
  });

  it("un anuncio no tiene hijos: solo su detalle", () => {
    expect(labels("ad")).toEqual(["Abrir el detalle del anuncio"]);
  });
});
