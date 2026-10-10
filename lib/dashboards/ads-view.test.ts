/**
 * Lo que arma el dashboard de anuncios para dibujar.
 */

import { describe, it, expect } from "vitest";
import type { BreakdownRow } from "@/lib/meta/live";
import type { AdsRow } from "./ads";
import { computeTotals, groupByObject } from "./ads";
import {
  AD_COLORS,
  adComparison,
  aggregateActions,
  audienceStack,
  campaignStack,
  colorMap,
  costLines,
  ctrByAge,
  dailyTableRows,
  deviceSummary,
  funnelSteps,
  genderTotals,
  hasAnyPoint,
  hourlySeries,
  kpiDelta,
  lastSyncedAt,
  latestRankings,
  parseAudience,
  placementSummary,
  rankingTone,
  sortRows,
  syncedLabel,
} from "./ads-view";

const row = (over: Partial<AdsRow> & { date: string }): AdsRow => ({
  level: "account",
  objectId: "act_1",
  objectName: null,
  parentName: null,
  campaignId: null,
  adsetId: null,
  spend: null,
  impressions: null,
  reach: null,
  clicks: null,
  outboundClicks: null,
  linkClicks: null,
  leads: null,
  purchases: null,
  purchaseValue: null,
  status: null,
  effectiveStatus: null,
  qualityRanking: null,
  engagementRanking: null,
  conversionRanking: null,
  videoP25: null,
  videoP50: null,
  videoP75: null,
  videoP95: null,
  videoP100: null,
  thruplays: null,
  videoAvgTimeSeconds: null,
  actions: {},
  updatedAt: null,
  ...over,
});

const breakdown = (over: Partial<BreakdownRow>): BreakdownRow => ({
  key: "?",
  spend: null,
  impressions: null,
  clicks: null,
  ctr: null,
  reach: null,
  leads: null,
  actions: {},
  age: null,
  gender: null,
  platform: null,
  position: null,
  device: null,
  hour: null,
  ...over,
});

describe("la variacion de los KPIs", () => {
  it("contra el periodo anterior, con un decimal", () => {
    expect(kpiDelta(112.3, 100)).toEqual({ percent: 12.3, tone: "good" });
    expect(kpiDelta(80, 100)).toEqual({ percent: -20, tone: "bad" });
  });

  it("en un costo, subir es malo y bajar es bueno", () => {
    expect(kpiDelta(12, 10, { invert: true })?.tone).toBe("bad");
    expect(kpiDelta(8, 10, { invert: true })?.tone).toBe("good");
  });

  it("sin el dato de un periodo, o con el anterior en cero, no hay variacion", () => {
    expect(kpiDelta(null, 10)).toBeNull();
    expect(kpiDelta(10, null)).toBeNull();
    expect(kpiDelta(10, 0)).toBeNull();
  });
});

describe("la ultima sincronizacion", () => {
  it("es la fila escrita mas tarde", () => {
    expect(
      lastSyncedAt([
        row({ date: "2026-10-01", updatedAt: "2026-10-09T10:00:00Z" }),
        row({ date: "2026-10-02", updatedAt: "2026-10-10T03:00:00Z" }),
        row({ date: "2026-10-03" }),
      ]),
    ).toBe("2026-10-10T03:00:00Z");
  });

  it("sin filas, null", () => {
    expect(lastSyncedAt([])).toBeNull();
  });
});

describe("el texto de la ultima sincronizacion", () => {
  const now = new Date("2026-10-10T15:00:00Z");

  it("hoy, ayer o la fecha, en la zona de quien mira", () => {
    expect(syncedLabel("2026-10-10T12:32:00Z", now, "America/Argentina/Buenos_Aires")).toBe("hoy 09:32");
    expect(syncedLabel("2026-10-09T22:10:00Z", now, "America/Argentina/Buenos_Aires")).toBe("ayer 19:10");
    expect(syncedLabel("2026-10-05T12:00:00Z", now, "America/Argentina/Buenos_Aires")).toBe("05/10 09:00");
  });

  it("sin fecha, o con una fecha rota, no hay texto", () => {
    expect(syncedLabel(null, now, "UTC")).toBeNull();
    expect(syncedLabel("no es una fecha", now, "UTC")).toBeNull();
  });
});

describe("las acciones generadas", () => {
  it("suma el periodo, muestra solo las de la lista y ordena de mayor a menor", () => {
    const items = aggregateActions([
      row({ date: "2026-10-01", actions: { link_click: 10, lead: 2, offsite_conversion: 99 } }),
      row({ date: "2026-10-02", actions: { link_click: 5, comment: 0 } }),
    ]);

    expect(items).toEqual([
      { type: "link_click", label: "Clics en enlace", value: 15 },
      { type: "lead", label: "Leads", value: 2 },
    ]);
  });
});

describe("los colores", () => {
  it("son estables: salen del orden por nombre, no del gasto", () => {
    const colors = colorMap([
      { id: "b", name: "Beta" },
      { id: "a", name: "Alfa" },
    ]);
    expect(colors).toEqual({ a: AD_COLORS[0], b: AD_COLORS[1] });
  });
});

describe("la comparativa por campaña", () => {
  const rows = [
    row({ date: "2026-10-01", level: "campaign", objectId: "c1", objectName: "Campaña Uno", campaignId: "c1" }),
    row({ date: "2026-10-01", level: "ad", objectId: "a1", objectName: "Video", campaignId: "c1", spend: 30 }),
    row({ date: "2026-10-02", level: "ad", objectId: "a1", objectName: "Video", campaignId: "c1", spend: 20 }),
    // Mismo nombre, otra campaña: no se puede sumar con el de arriba.
    row({ date: "2026-10-01", level: "ad", objectId: "a2", objectName: "Video", campaignId: "c2", spend: 7 }),
  ];

  it("una barra por campaña, un tramo por anuncio, por id y no por nombre", () => {
    const { data, series } = campaignStack({ rows, metric: "spend" });

    expect(data).toContainEqual({ campaign: "Campaña Uno", a1: 50 });
    expect(data).toContainEqual({ campaign: "c2", a2: 7 });
    expect(series.map((s) => s.key).sort()).toEqual(["a1", "a2"]);
  });

  it("el alcance del tramo es el unico, si llego", () => {
    const { data } = campaignStack({
      rows: [
        row({ date: "2026-10-01", level: "ad", objectId: "a1", campaignId: "c1", reach: 100 }),
        row({ date: "2026-10-02", level: "ad", objectId: "a1", campaignId: "c1", reach: 100 }),
      ],
      metric: "reach",
      adReach: { a1: 130 },
    });
    expect(data[0].a1).toBe(130);
  });
});

describe("la comparativa por anuncio", () => {
  it("de mayor a menor, sin los que no tienen valor", () => {
    const ads = groupByObject(
      [
        row({ date: "2026-10-01", level: "ad", objectId: "a1", objectName: "A", leads: 3 }),
        row({ date: "2026-10-01", level: "ad", objectId: "a2", objectName: "B", leads: 9 }),
        row({ date: "2026-10-01", level: "ad", objectId: "a3", objectName: "C" }),
      ],
      "ad",
    );
    expect(adComparison({ ads, metric: "leads" }).map((a) => [a.id, a.value])).toEqual([
      ["a2", 9],
      ["a1", 3],
    ]);
  });
});

describe("el costo por campaña", () => {
  const rows = [
    row({ date: "2026-10-01", level: "campaign", objectId: "c1", objectName: "Uno", spend: 10, clicks: 5, leads: 1 }),
    // Un dia con gasto y sin clics: el CPC no es cero, no existe.
    row({ date: "2026-10-02", level: "campaign", objectId: "c1", objectName: "Uno", spend: 10, clicks: 0 }),
    row({ date: "2026-10-03", level: "campaign", objectId: "c1", objectName: "Uno", spend: 9, clicks: 3 }),
    row({ date: "2026-10-01", level: "campaign", objectId: "c2", objectName: "Sin gasto", spend: 0 }),
  ];

  it("un dia sin clics es un hueco en la linea, no un cero", () => {
    const { data } = costLines({ rows, level: "campaign", metric: "cpc" });
    expect(data.map((d) => d.c1)).toEqual([2, null, 3]);
    expect(data[0].date).toBe("10-01");
  });

  it("las campañas que no gastaron no tienen linea", () => {
    const { series } = costLines({ rows, level: "campaign", metric: "cpc" });
    expect(series.map((s) => s.key)).toEqual(["c1"]);
  });

  it("sin leads en ningun dia, no hay ni un punto de CPL", () => {
    const { data, series } = costLines({
      rows: rows.map((r) => ({ ...r, leads: null })),
      level: "campaign",
      metric: "cpl",
    });
    expect(hasAnyPoint(data, series)).toBe(false);
  });
});

describe("los placements", () => {
  const rows = [
    breakdown({ platform: "instagram", position: "instagram_stories", spend: 60, impressions: 1000, clicks: 50 }),
    breakdown({ platform: "facebook", position: "feed", spend: 40, impressions: 1000, clicks: 10 }),
    breakdown({ platform: "audience_network", position: "classic", spend: 0, impressions: 0, clicks: 0, ctr: 0 }),
  ];

  it("ordena por el toggle y calcula la parte de cada uno", () => {
    const { items } = placementSummary(rows, "spend");
    expect(items[0]).toMatchObject({ name: "instagram · instagram stories", share: 60 });
  });

  it("el mejor y el peor CTR, sin contar los que no tuvieron impresiones", () => {
    const { best, worst } = placementSummary(rows, "spend");
    expect(best?.ctr).toBe(5);
    expect(worst?.ctr).toBe(1);
  });

  it("el CTR de un placement sin impresiones es null, no cero", () => {
    const { items } = placementSummary(rows, "ctr");
    expect(items.find((i) => i.name.startsWith("audience"))?.ctr).toBeNull();
  });

  it("con un solo placement, no hay peor", () => {
    expect(placementSummary([rows[0]], "spend").worst).toBeNull();
  });
});

describe("los dispositivos", () => {
  it("parte del gasto con etiqueta, y CTR propio", () => {
    const items = deviceSummary([
      breakdown({ device: "mobile_app", spend: 75, impressions: 100, clicks: 4 }),
      breakdown({ device: "desktop", spend: 25, impressions: 0, clicks: 0 }),
    ]);
    expect(items[0]).toMatchObject({ name: "📱 Mobile (App)", share: 75, ctr: 4 });
    expect(items[1].ctr).toBeNull();
  });
});

describe("la audiencia", () => {
  const data = parseAudience([
    breakdown({ age: "25-34", gender: "female", reach: 600, impressions: 1000, clicks: 30, leads: 4 }),
    breakdown({ age: "25-34", gender: "male", reach: 400, impressions: 1000, clicks: 10, leads: null }),
    breakdown({ age: "18-24", gender: "unknown", reach: 0, impressions: 0, clicks: 0 }),
  ]);

  it("apila por edad, en el orden de las franjas", () => {
    const { rows, genders } = audienceStack(data, "reach");
    expect(rows.map((r) => r.age)).toEqual(["18-24", "25-34"]);
    expect(genders).toEqual(["male", "female"]);
  });

  it("la dona reparte el alcance por genero", () => {
    expect(genderTotals(data).map((g) => [g.gender, g.share])).toEqual([
      ["male", 40],
      ["female", 60],
    ]);
  });

  it("el CTR por edad se calcula sobre clics e impresiones", () => {
    const { rows } = ctrByAge(data);
    expect(rows).toEqual([{ age: "25-34", male: 1, female: 3 }]);
  });
});

describe("el horario", () => {
  it("24 horas, y las que no tuvieron entrega quedan en null", () => {
    const series = hourlySeries([breakdown({ hour: 14, spend: 5, clicks: 2, impressions: 100 })]);
    expect(series).toHaveLength(24);
    expect(series[14]).toMatchObject({ label: "14:00", spend: 5, ctr: 2 });
    expect(series[3].spend).toBeNull();
  });
});

describe("los rankings", () => {
  it("todos los BELOW_AVERAGE son inferiores", () => {
    expect(rankingTone("BELOW_AVERAGE_35")).toBe("below");
    expect(rankingTone("BELOW_AVERAGE_10")).toBe("below");
    expect(rankingTone("ABOVE_AVERAGE")).toBe("above");
    expect(rankingTone("UNKNOWN")).toBeNull();
  });

  it("de cada anuncio, el ultimo que dio Meta, por tipo", () => {
    const rankings = latestRankings([
      row({ date: "2026-10-01", level: "ad", objectId: "a1", qualityRanking: "AVERAGE", engagementRanking: "ABOVE_AVERAGE" }),
      row({ date: "2026-10-02", level: "ad", objectId: "a1", qualityRanking: "BELOW_AVERAGE_20" }),
    ]);
    expect(rankings.a1).toEqual({ quality: "BELOW_AVERAGE_20", engagement: "ABOVE_AVERAGE", conversion: null });
  });
});

describe("las metricas por dia", () => {
  it("cada dia con sus cuentas, y un dia sin clics no tiene CPC", () => {
    const rows = dailyTableRows([
      row({ date: "2026-10-01", spend: 10, clicks: 5, impressions: 1000 }),
      row({ date: "2026-10-02", spend: 4, clicks: 0, impressions: 200 }),
    ]);
    expect(rows[0]).toMatchObject({ date: "2026-10-01", cpc: 2, ctr: 0.5, cpm: 10 });
    expect(rows[1].cpc).toBeNull();
  });

  it("se ordena por cualquier columna, con los vacios siempre al final", () => {
    const rows = [
      { date: "a", cpc: 3 },
      { date: "b", cpc: null },
      { date: "c", cpc: 1 },
    ];
    expect(sortRows(rows, "cpc", "desc").map((r) => r.date)).toEqual(["a", "c", "b"]);
    expect(sortRows(rows, "cpc", "asc").map((r) => r.date)).toEqual(["c", "a", "b"]);
    expect(sortRows(rows, "date", "desc").map((r) => r.date)).toEqual(["c", "b", "a"]);
  });
});

describe("el embudo", () => {
  it("impresiones, clics y leads, cada uno sobre el anterior", () => {
    const steps = funnelSteps(
      computeTotals([row({ date: "2026-10-01", impressions: 10000, outboundClicks: 200, leads: 20 })]),
    );
    expect(steps).toEqual([
      { label: "Impresiones", value: 10000, percent: 100 },
      { label: "Clics", value: 200, percent: 2 },
      { label: "Leads", value: 20, percent: 10 },
    ]);
  });

  it("las compras entran solo si hubo", () => {
    const steps = funnelSteps(
      computeTotals([row({ date: "2026-10-01", impressions: 100, clicks: 10, leads: 5, purchases: 1 })]),
    );
    expect(steps?.[3]).toEqual({ label: "Compras", value: 1, percent: 20 });
  });

  it("sin leads ni compras no hay embudo", () => {
    expect(funnelSteps(computeTotals([row({ date: "2026-10-01", impressions: 100 })]))).toBeNull();
  });
});
