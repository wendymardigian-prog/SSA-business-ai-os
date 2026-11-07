import { describe, expect, it } from "vitest";
import { drillChips, drillScope, drillTargets, drillToParams, parseDrill, withLevel } from "./ads-drill";

const params = (query: string) => new URLSearchParams(query);

describe("parseDrill", () => {
  it("sin nada, son las campañas sin filtro", () => {
    expect(parseDrill(params(""))).toEqual({ level: "campaign", campaignId: null, adsetId: null });
  });

  it("lee el nivel y sus padres", () => {
    expect(parseDrill(params("nivel=adsets&campana=11"))).toEqual({ level: "adset", campaignId: "11", adsetId: null });
    expect(parseDrill(params("nivel=anuncios&campana=11&conjunto=22"))).toEqual({ level: "ad", campaignId: "11", adsetId: "22" });
  });

  it("ignora lo que no corresponde al nivel y lo que no parece un id", () => {
    expect(parseDrill(params("campana=11&conjunto=22")).campaignId).toBeNull();
    expect(parseDrill(params("nivel=adsets&conjunto=22")).adsetId).toBeNull();
    expect(parseDrill(params("nivel=adsets&campana=a%27%20or%201")).campaignId).toBeNull();
    expect(parseDrill(params("nivel=cualquiera")).level).toBe("campaign");
  });
});

describe("drillToParams", () => {
  it("no toca la cuenta ni el periodo", () => {
    const next = drillToParams(params("cuenta=act_1&range=7d&nivel=adsets&campana=11"), { level: "ad", campaignId: "11", adsetId: "22" });
    expect(next.toString()).toBe("cuenta=act_1&range=7d&nivel=anuncios&campana=11&conjunto=22");
  });

  it("volver a Campañas deja la URL limpia", () => {
    const next = drillToParams(params("cuenta=act_1&nivel=anuncios&campana=11&conjunto=22"), { level: "campaign", campaignId: null, adsetId: null });
    expect(next.toString()).toBe("cuenta=act_1");
  });

  it("ida y vuelta da lo mismo", () => {
    const state = { level: "ad", campaignId: "11", adsetId: "22" } as const;
    expect(parseDrill(drillToParams(params(""), state))).toEqual(state);
  });
});

describe("drillScope", () => {
  it("gana el padre mas cercano", () => {
    expect(drillScope({ level: "ad", campaignId: "11", adsetId: "22" })).toEqual({ level: "adset", id: "22" });
    expect(drillScope({ level: "ad", campaignId: "11", adsetId: null })).toEqual({ level: "campaign", id: "11" });
    expect(drillScope({ level: "adset", campaignId: "11", adsetId: null })).toEqual({ level: "campaign", id: "11" });
    expect(drillScope({ level: "campaign", campaignId: null, adsetId: null })).toBeNull();
  });
});

describe("withLevel: cambiar de pestaña", () => {
  const state = { level: "ad", campaignId: "11", adsetId: "22" } as const;

  it("Campañas limpia los filtros", () => {
    expect(withLevel(state, "campaign")).toEqual({ level: "campaign", campaignId: null, adsetId: null });
  });

  it("AdSets conserva la campaña y saca el AdSet", () => {
    expect(withLevel(state, "adset")).toEqual({ level: "adset", campaignId: "11", adsetId: null });
  });
});

describe("drillTargets: el menu de una fila", () => {
  const labels = (level: "campaign" | "adset" | "ad") => drillTargets(level, { objectId: "9", campaignId: "11" }).map((t) => t.label);

  it("una campaña baja a sus AdSets o a sus anuncios", () => {
    expect(labels("campaign")).toEqual(["Ver AdSets", "Ver anuncios", "Abrir el detalle de la campaña"]);
    expect(drillTargets("campaign", { objectId: "9", campaignId: null })[1]).toMatchObject({ state: { level: "ad", campaignId: "9", adsetId: null } });
  });

  it("un AdSet baja a sus anuncios y conserva su campaña", () => {
    expect(labels("adset")).toEqual(["Ver anuncios", "Abrir el detalle del AdSet"]);
    expect(drillTargets("adset", { objectId: "9", campaignId: "11" })[0]).toMatchObject({ state: { level: "ad", campaignId: "11", adsetId: "9" } });
  });

  it("un anuncio no tiene hijos: solo su detalle", () => {
    expect(labels("ad")).toEqual(["Abrir el detalle del anuncio"]);
  });
});

describe("drillChips", () => {
  const nameOf = (level: "campaign" | "adset") => (level === "campaign" ? "Clase" : null);

  it("muestra cada filtro y como queda al sacarlo", () => {
    const chips = drillChips({ level: "ad", campaignId: "11", adsetId: "22" }, nameOf);
    expect(chips.map((c) => [c.label, c.name])).toEqual([["Campaña", "Clase"], ["AdSet", null]]);
    expect(chips[0].clear).toEqual({ level: "ad", campaignId: null, adsetId: null });
    expect(chips[1].clear).toEqual({ level: "ad", campaignId: "11", adsetId: null });
  });

  it("sin filtros no hay nada que mostrar", () => {
    expect(drillChips({ level: "campaign", campaignId: null, adsetId: null }, nameOf)).toEqual([]);
  });
});
