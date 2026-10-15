import { describe, expect, it } from "vitest";
import type { AdsRow } from "./ads";
import { metaCountersOf, metaRatios, rankingLabel, sumMetaCounters, sumOrNull } from "./ads-meta-metrics";

const row = (over: Partial<AdsRow> = {}): AdsRow => ({
  level: "ad", objectId: "a1", objectName: "A", parentName: null, campaignId: null, adsetId: null, date: "2026-10-01",
  spend: 100, impressions: 1000, reach: 500, clicks: 30, outboundClicks: null, linkClicks: null, leads: null, purchases: null, purchaseValue: null,
  status: null, effectiveStatus: null, qualityRanking: null, engagementRanking: null, conversionRanking: null,
  videoP25: null, videoP50: null, videoP75: null, videoP95: null, videoP100: null, thruplays: null, videoAvgTimeSeconds: null,
  actions: {}, updatedAt: null, ...over,
});

describe("los contadores salen de lo que se guarda", () => {
  it("lo que Meta no manda es null, nunca 0", () => {
    const c = metaCountersOf([row()]);
    expect(c.linkClicks).toBeNull();
    expect(c.video3s).toBeNull();
    expect(c.viewContent).toBeNull();
    expect(c.applications).toBeNull();
    expect(c.bookingsMeta).toBeNull();
    expect(c.watchSeconds).toBeNull();
  });

  it("suma los dias de un objeto", () => {
    const c = metaCountersOf([
      row({ date: "2026-10-01", linkClicks: 10, thruplays: 4, videoP25: 8, actions: { video_view: 20, omni_view_content: 5 } }),
      row({ date: "2026-10-02", linkClicks: 5, thruplays: 1, videoP25: 2, actions: { video_view: 10, view_content: 2, omni_view_content: 2 } }),
    ]);
    expect(c).toMatchObject({ linkClicks: 15, thruplays: 5, videoP25: 10, video3s: 30, viewContent: 7 });
  });

  it("el mismo evento con varios nombres el mismo dia cuenta UNA vez", () => {
    const c = metaCountersOf([row({ actions: { omni_view_content: 9, view_content: 9, "offsite_conversion.fb_pixel_view_content": 9, omni_submit_application: 3, submit_application: 3 } })]);
    expect(c.viewContent).toBe(9);
    expect(c.applications).toBe(3);
  });

  it("los rankings son los del ultimo dia que los trae", () => {
    const c = metaCountersOf([
      row({ date: "2026-10-01", qualityRanking: "BELOW_AVERAGE" }),
      row({ date: "2026-10-03", qualityRanking: "ABOVE_AVERAGE" }),
      row({ date: "2026-10-05", qualityRanking: null, engagementRanking: "AVERAGE" }),
    ]);
    expect(c.qualityRanking).toBe("ABOVE_AVERAGE");
    expect(c.engagementRanking).toBe("AVERAGE");
    expect(c.conversionRanking).toBeNull();
  });
});

describe("los cocientes se calculan SOBRE contadores", () => {
  it("hook rate, hold rate y retencion", () => {
    const c = metaCountersOf([row({ impressions: 1000, thruplays: 25, videoP25: 80, videoP50: 60, videoP75: 40, videoP100: 20, actions: { video_view: 100 } })]);
    const r = metaRatios(c, { spend: 50, impressions: 1000 });
    expect(r).toMatchObject({ hookRate: 10, holdRate: 25, retention25: 80, retention50: 60, retention75: 40, retention100: 20, costPerVideo3s: 0.5 });
  });

  it("clics en el enlace: CTR y CPC", () => {
    const r = metaRatios(metaCountersOf([row({ linkClicks: 20 })]), { spend: 50, impressions: 1000 });
    expect(r).toMatchObject({ linkCtr: 2, linkCpc: 2.5 });
  });

  it("compras: costo, valor y ROAS Meta", () => {
    const r = metaRatios(metaCountersOf([row({ purchases: 5, purchaseValue: 400 })]), { spend: 100, impressions: 1000 });
    expect(r).toMatchObject({ costPerPurchase: 20, roasMeta: 4 });
  });

  it("una division por cero es null", () => {
    const r = metaRatios(metaCountersOf([row({ linkClicks: 0, purchases: 0 })]), { spend: 0, impressions: 0 });
    expect(r.linkCtr).toBeNull();
    expect(r.linkCpc).toBeNull();
    expect(r.costPerPurchase).toBeNull();
    expect(r.roasMeta).toBeNull();
  });

  it("el tiempo promedio visto pesa cada dia por sus reproducciones", () => {
    const c = metaCountersOf([
      row({ date: "2026-10-01", videoAvgTimeSeconds: 10, actions: { video_view: 100 } }),
      row({ date: "2026-10-02", videoAvgTimeSeconds: 2, actions: { video_view: 300 } }),
      row({ date: "2026-10-03", videoAvgTimeSeconds: 99, actions: {} }),
    ]);
    expect(metaRatios(c, { spend: 1, impressions: 1 }).avgWatchSeconds).toBe(4);
  });
});

describe("el total suma contadores y recalcula", () => {
  it("hook rate total = Σ reproducciones ÷ Σ impresiones, no el promedio de las filas", () => {
    const a = metaCountersOf([row({ impressions: 1000, actions: { video_view: 500 } })]);
    const b = metaCountersOf([row({ impressions: 9000, actions: { video_view: 100 } })]);
    const total = sumMetaCounters([a, b]);
    expect(total.video3s).toBe(600);
    expect(metaRatios(total, { spend: 10, impressions: 10000 }).hookRate).toBe(6);
  });

  it("los rankings no se suman, y un total sin nada de Meta no inventa ceros", () => {
    const total = sumMetaCounters([metaCountersOf([row({ qualityRanking: "AVERAGE" })])]);
    expect(total.qualityRanking).toBeNull();
    expect(total.video3s).toBeNull();
    expect(sumMetaCounters([]).linkClicks).toBeNull();
  });

  it("sumOrNull: null si nada lo trajo", () => {
    expect(sumOrNull([null, undefined])).toBeNull();
    expect(sumOrNull([null, 2, 3])).toBe(5);
    expect(sumOrNull([0, null])).toBe(0);
  });
});

describe("rankingLabel", () => {
  it("los de Meta en castellano; lo desconocido tal cual; sin dato null", () => {
    expect(rankingLabel("ABOVE_AVERAGE")).toBe("Por encima del promedio");
    expect(rankingLabel("BELOW_AVERAGE_35")).toBe("Entre el 35 % peor");
    expect(rankingLabel("ALGO_NUEVO")).toBe("ALGO_NUEVO");
    expect(rankingLabel(null)).toBeNull();
  });
});
