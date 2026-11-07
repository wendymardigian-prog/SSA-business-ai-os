import { describe, expect, it } from "vitest";
import type { CrmRow } from "./ads-crm";
import { COLUMN_BY_ID } from "./ads-crm-columns";
import { COLUMN_BETTER, cellTone, columnReferences, median, toneNote } from "./ads-tone";
import { parsePinned, parseSort, serializeSort, sortByColumn, splitPinned, stickyOffsets, togglePinned, parseColors } from "./ads-table-view";
import {
  EMPTY_FILTERS,
  activeFilterChips,
  adsTableFiltersToParams,
  applyAdsTableFilters,
  clearFilters,
  countMenuFilters,
  hasActiveFilters,
  parseAdsTableFilters,
  parseAmount,
  withoutAccountFilters,
  type FilterContext,
} from "./ads-table-filters";

/** Una fila con lo justo: el resto de los campos no se lee en estas pruebas. */
const row = (over: Partial<CrmRow>): CrmRow =>
  ({ objectId: "x", name: "Fila", effectiveStatus: "ACTIVE", statusKind: "active", campaignId: null, adsetId: null, objective: null, spend: 10, leadsTotal: 1, cplTotal: null, linkCtr: null, ...over }) as CrmRow;

describe("el semáforo (ads-tone)", () => {
  it("la mediana es el valor del medio", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("solo pinta las métricas de eficiencia", () => {
    expect(COLUMN_BETTER.cplTotal).toBe("lower");
    expect(COLUMN_BETTER.linkCtr).toBe("higher");
    expect(COLUMN_BETTER.spend).toBeUndefined();
    expect(COLUMN_BETTER.leadsTotal).toBeUndefined();
  });

  it("un costo 20 % más bajo que el medio es bueno, 20 % más alto es malo, cerca no tiene color", () => {
    expect(cellTone(0.8, 1, "lower")?.tone).toBe("good");
    expect(cellTone(1.2, 1, "lower")?.tone).toBe("bad");
    expect(cellTone(1.1, 1, "lower")).toBeNull();
    expect(cellTone(0.9, 1, "lower")).toBeNull();
  });

  it("en lo que conviene alto, al revés", () => {
    expect(cellTone(1.5, 1, "higher")?.tone).toBe("good");
    expect(cellTone(0.5, 1, "higher")?.tone).toBe("bad");
  });

  it("sin valor, sin referencia o con mediana 0 no hay color", () => {
    expect(cellTone(null, 1, "lower")).toBeNull();
    expect(cellTone(1, undefined, "lower")).toBeNull();
    expect(cellTone(1, 0, "lower")).toBeNull();
    expect(cellTone(1, 2, undefined)).toBeNull();
  });

  it("con menos de 3 valores no hay con qué comparar", () => {
    const cpl = COLUMN_BY_ID.cplTotal;
    const two = [row({ objectId: "a", cplTotal: 1 }), row({ objectId: "b", cplTotal: 3 }), row({ objectId: "c", cplTotal: null })];
    expect(columnReferences(two, [cpl]).cplTotal).toBeUndefined();
    const three = [...two, row({ objectId: "d", cplTotal: 2 })];
    expect(columnReferences(three, [cpl]).cplTotal).toBe(2);
  });

  it("el Total no entra en la mediana y las columnas sin semáforo no tienen referencia", () => {
    const rows = [1, 2, 3].map((v) => row({ objectId: String(v), cplTotal: v, spend: v }));
    expect(columnReferences([...rows, row({ objectId: "total", cplTotal: 100 })], [COLUMN_BY_ID.cplTotal]).cplTotal).toBe(2);
    expect(columnReferences(rows, [COLUMN_BY_ID.spend]).spend).toBeUndefined();
  });

  it("explica el color en palabras", () => {
    const result = cellTone(0.66, 1, "lower")!;
    expect(toneNote(result, "lower", true, "$ 1,00")).toBe("34 % más barato que el medio de lo que ves ($ 1,00)");
    expect(toneNote(cellTone(2, 1, "higher")!, "higher", false, "1 %")).toBe("100 % más alto que el medio de lo que ves (1 %)");
  });
});

describe("ordenar por una columna", () => {
  const rows = [row({ objectId: "a", name: "Beta", cplTotal: 2 }), row({ objectId: "b", name: "alfa", cplTotal: null }), row({ objectId: "c", name: "Ñandú", cplTotal: 1 })];
  const ids = (out: CrmRow[]) => out.map((r) => r.objectId);

  it("de menor a mayor y de mayor a menor, con lo vacío siempre al final", () => {
    expect(ids(sortByColumn(rows, { key: "cplTotal", dir: "asc" }))).toEqual(["c", "a", "b"]);
    expect(ids(sortByColumn(rows, { key: "cplTotal", dir: "desc" }))).toEqual(["a", "c", "b"]);
  });

  it("el nombre se ordena alfabético, sin importar mayúsculas", () => {
    expect(ids(sortByColumn(rows, { key: "name", dir: "asc" }))).toEqual(["b", "a", "c"]);
  });

  it("sin orden, queda como estaba", () => {
    expect(sortByColumn(rows, null)).toBe(rows);
  });

  it("lee y escribe el orden de la URL, y descarta lo desconocido", () => {
    expect(parseSort("cplTotal:asc")).toEqual({ key: "cplTotal", dir: "asc" });
    expect(parseSort("spend")).toEqual({ key: "spend", dir: "desc" });
    expect(parseSort("inventada:asc")).toBeNull();
    expect(serializeSort({ key: "name", dir: "asc" })).toBe("name:asc");
  });
});

describe("columnas fijas", () => {
  it("se acumulan en el orden en que se fijan y se sueltan", () => {
    expect(togglePinned(togglePinned([], "spend"), "cplTotal")).toEqual(["spend", "cplTotal"]);
    expect(togglePinned(["spend", "cplTotal"], "spend")).toEqual(["cplTotal"]);
  });

  it("lo guardado se lee sin confiar en el", () => {
    expect(parsePinned('["spend","inventada","spend","cplTotal"]')).toEqual(["spend", "cplTotal"]);
    expect(parsePinned("{roto")).toEqual([]);
    expect(parsePinned(null)).toEqual([]);
  });

  it("las fijas van primero, solo las que se ven", () => {
    const columns = [COLUMN_BY_ID.status, COLUMN_BY_ID.spend, COLUMN_BY_ID.cplTotal];
    const { pinned, rest } = splitPinned(columns, ["cplTotal", "reach", "spend"]);
    expect(pinned.map((c) => c.id)).toEqual(["cplTotal", "spend"]);
    expect(rest.map((c) => c.id)).toEqual(["status"]);
  });

  it("cada fija arranca donde termina la anterior", () => {
    expect(stickyOffsets(200, [80, 100])).toEqual([200, 280]);
  });

  it("los colores están prendidos salvo que se apaguen", () => {
    expect(parseColors(null)).toBe(true);
    expect(parseColors("off")).toBe(false);
  });
});

describe("filtros de la pantalla Anuncios", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("ida y vuelta por la URL, sin tocar la cuenta ni la pestaña", () => {
    const query = "cuenta=act_1&nivel=anuncios&q=clase&estado=activos&campana=11,12&conjunto=22&objetivo=OUTCOME_LEADS&gasto_min=5&gasto_max=50.5&con_gasto=1&con_leads=1&orden=cplTotal:asc";
    const filters = parseAdsTableFilters(params(query));
    expect(filters).toMatchObject({ q: "clase", status: "active", campaignIds: ["11", "12"], adsetIds: ["22"], spendMin: 5, spendMax: 50.5, withSpend: true, withLeads: true });
    const back = adsTableFiltersToParams(params("cuenta=act_1&nivel=anuncios"), filters);
    expect(back.get("cuenta")).toBe("act_1");
    expect(back.get("nivel")).toBe("anuncios");
    expect(parseAdsTableFilters(back)).toEqual(filters);
  });

  it("un solo id de campaña (el link de «Ver AdSets») sigue valiendo", () => {
    expect(parseAdsTableFilters(params("nivel=adsets&campana=11")).campaignIds).toEqual(["11"]);
  });

  it("lo que no parece un id, un objetivo o un monto se ignora", () => {
    const filters = parseAdsTableFilters(params("campana=a%27%20or%201,11&objetivo=drop table&gasto_min=-3&gasto_max=abc&estado=raro"));
    expect(filters.campaignIds).toEqual(["11"]);
    expect(filters.objectives).toEqual([]);
    expect(filters.spendMin).toBeNull();
    expect(filters.spendMax).toBeNull();
    expect(filters.status).toBe("all");
    expect(parseAmount("12,5")).toBe(12.5);
  });

  it("sin filtros la URL queda limpia", () => {
    expect(adsTableFiltersToParams(params("cuenta=act_1&q=x&orden=spend:desc"), EMPTY_FILTERS).toString()).toBe("cuenta=act_1");
  });

  const ctx = (level: FilterContext["level"]): FilterContext => ({
    level,
    campaignObjective: (id) => ({ c1: "OUTCOME_LEADS", c2: "OUTCOME_SALES" })[id] ?? null,
    campaignOfAdset: (id) => ({ s1: "c1", s2: "c2" })[id] ?? null,
  });
  const campaigns = [
    row({ objectId: "c1", name: "Campaña de prueba", objective: "OUTCOME_LEADS", spend: 80, leadsTotal: 10 }),
    row({ objectId: "c2", name: "Imágenes de prueba", objective: "OUTCOME_SALES", spend: 0, leadsTotal: 0 }),
  ];
  const adsets = [row({ objectId: "s1", campaignId: "c1", name: "Seguidores" }), row({ objectId: "s2", campaignId: "c2", name: "Público nuevo" })];
  const ads = [row({ objectId: "a1", campaignId: "c1", adsetId: "s1" }), row({ objectId: "a2", campaignId: "c2", adsetId: "s2" })];
  const ids = (out: CrmRow[]) => out.map((r) => r.objectId);
  const apply = (rows: CrmRow[], level: FilterContext["level"], over: Partial<typeof EMPTY_FILTERS>) => ids(applyAdsTableFilters(rows, { ...EMPTY_FILTERS, ...over }, ctx(level)));

  it("busca por nombre sin tildes ni mayúsculas", () => {
    expect(apply(campaigns, "campaign", { q: "imagenes" })).toEqual(["c2"]);
  });

  it("la campaña vale en las tres pestañas", () => {
    expect(apply(campaigns, "campaign", { campaignIds: ["c1"] })).toEqual(["c1"]);
    expect(apply(adsets, "adset", { campaignIds: ["c1"] })).toEqual(["s1"]);
    expect(apply(ads, "ad", { campaignIds: ["c2"] })).toEqual(["a2"]);
  });

  it("el conjunto también: en Campañas muestra las que lo contienen", () => {
    expect(apply(campaigns, "campaign", { adsetIds: ["s2"] })).toEqual(["c2"]);
    expect(apply(adsets, "adset", { adsetIds: ["s2"] })).toEqual(["s2"]);
    expect(apply(ads, "ad", { adsetIds: ["s1"] })).toEqual(["a1"]);
  });

  it("el objetivo de un anuncio es el de su campaña", () => {
    expect(apply(campaigns, "campaign", { objectives: ["OUTCOME_SALES"] })).toEqual(["c2"]);
    expect(apply(ads, "ad", { objectives: ["OUTCOME_LEADS"] })).toEqual(["a1"]);
  });

  it("con gasto, con leads y gasto desde/hasta", () => {
    expect(apply(campaigns, "campaign", { withSpend: true })).toEqual(["c1"]);
    expect(apply(campaigns, "campaign", { withLeads: true })).toEqual(["c1"]);
    expect(apply(campaigns, "campaign", { spendMin: 50 })).toEqual(["c1"]);
    expect(apply(campaigns, "campaign", { spendMax: 50 })).toEqual(["c2"]);
  });

  it("el globito cuenta los filtros del menú; la búsqueda y el estado se ven aparte", () => {
    const filters = { ...EMPTY_FILTERS, q: "x", status: "active" as const, campaignIds: ["1", "2"], spendMin: 1, spendMax: 2, withLeads: true };
    expect(countMenuFilters(filters)).toBe(3);
    expect(hasActiveFilters(filters)).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: { key: "spend", dir: "asc" } })).toBe(false);
  });

  it("los chips dicen qué hay puesto y cómo queda al sacarlo", () => {
    const filters = { ...EMPTY_FILTERS, campaignIds: ["c1"], adsetIds: ["s1", "s2"], spendMin: 5, withSpend: true };
    const chips = activeFilterChips(filters, { campaign: () => "Campaña de prueba", adset: () => null, objective: (v) => v, money: (v) => `$ ${v}` });
    expect(chips.map((c) => c.label)).toEqual(["Campaña: Campaña de prueba", "2 AdSets", "Gasto desde $ 5", "Con gasto"]);
    expect(chips[0].clear.campaignIds).toEqual([]);
    expect(chips[0].clear.adsetIds).toEqual(["s1", "s2"]);
  });

  it("limpiar conserva el orden; cambiar de cuenta saca campaña y conjunto", () => {
    const filters = { ...EMPTY_FILTERS, q: "x", campaignIds: ["1"], withSpend: true, sort: { key: "spend" as const, dir: "asc" as const } };
    expect(clearFilters(filters)).toEqual({ ...EMPTY_FILTERS, sort: filters.sort });
    expect(withoutAccountFilters(filters)).toMatchObject({ q: "x", campaignIds: [], withSpend: true });
  });
});
