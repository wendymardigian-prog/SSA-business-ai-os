import { describe, expect, it } from "vitest";
import type { AdsRow } from "./ads";
import { buildCrmRows, countByStatus, crmRatios, filterByStatus, scheduleCount, sortCrmRows, statusKind, totalRow, type CrmMetrics } from "./ads-crm";

const adsRow = (over: Partial<AdsRow> = {}): AdsRow => ({
  level: "ad", objectId: "a1", objectName: "Anuncio", parentName: "Conjunto", campaignId: "c1", adsetId: "s1", date: "2026-10-01",
  spend: 10, impressions: 1000, reach: 800, clicks: 20, outboundClicks: 15, linkClicks: 15, leads: 2, purchases: 0, purchaseValue: 0,
  status: "ACTIVE", effectiveStatus: null, qualityRanking: null, engagementRanking: null, conversionRanking: null,
  videoP25: null, videoP50: null, videoP75: null, videoP95: null, videoP100: null, thruplays: null, videoAvgTimeSeconds: null,
  actions: {}, updatedAt: null, ...over,
});

const crm = (over: Partial<CrmMetrics> = {}): CrmMetrics => ({
  objectId: "a1", leadsFirst: 1, leadsTotal: 4, leadsWithBooking: 2, bookings: 2, bookingsAttended: 1, sales: 1, revenueCents: 200000, cashCents: 50000, ...over,
});

describe("crmRatios (division por cero = «—»)", () => {
  const base = { spend: 320, leadsTotal: 14, leadsWithBooking: 6, bookings: 6, sales: 1, revenue: 2000, cash: 500 };

  it("el ejemplo del alcance: costo por agenda 53,33 y ROAS 6,25", () => {
    const r = crmRatios(base);
    expect(r.costPerBooking).toBe(53.33);
    expect(r.roas).toBe(6.25);
    expect(r.roasCash).toBe(1.56);
    expect(r.cplReal).toBe(22.86);
    expect(r.leadToBooking).toBe(42.86);
    expect(r.cac).toBe(320);
    expect(r.costPerClose).toBe(320);
  });

  it("CPL real con 0 leads es «—», no 0", () => {
    expect(crmRatios({ ...base, leadsTotal: 0 }).cplReal).toBeNull();
    expect(crmRatios({ ...base, leadsTotal: 0 }).leadToBooking).toBeNull();
  });

  it("ROAS con gasto 0 o sin gasto es «—»", () => {
    expect(crmRatios({ ...base, spend: 0 }).roas).toBeNull();
    expect(crmRatios({ ...base, spend: null }).roas).toBeNull();
    expect(crmRatios({ ...base, spend: null }).roasCash).toBeNull();
  });

  it("sin ventas o sin agendas, CAC, costo por cierre y costo por agenda son «—»", () => {
    const r = crmRatios({ ...base, sales: 0, bookings: 0 });
    expect(r.cac).toBeNull();
    expect(r.costPerClose).toBeNull();
    expect(r.costPerBooking).toBeNull();
  });
});

describe("estado", () => {
  it("activo, pausado (incluye CAMPAIGN_PAUSED y ADSET_PAUSED) y otro", () => {
    expect(statusKind("ACTIVE")).toBe("active");
    for (const s of ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]) expect(statusKind(s), s).toBe("paused");
    for (const s of ["ARCHIVED", "DELETED", "WITH_ISSUES", "IN_PROCESS", null, undefined]) expect(statusKind(s as string | null), String(s)).toBe("other");
  });

  it("el filtro «Pausados» incluye CAMPAIGN_PAUSED; «Activos» solo ACTIVE; «Todos» todo", () => {
    const rows = buildCrmRows({
      rows: [adsRow({ objectId: "a1" }), adsRow({ objectId: "a2" }), adsRow({ objectId: "a3" }), adsRow({ objectId: "a4" })],
      level: "ad",
      metrics: [],
      catalog: {
        a1: { name: "Uno", effectiveStatus: "ACTIVE" },
        a2: { name: "Dos", effectiveStatus: "CAMPAIGN_PAUSED" },
        a3: { name: "Tres", effectiveStatus: "PAUSED" },
        a4: { name: "Cuatro", effectiveStatus: "ARCHIVED" },
      },
    });
    expect(filterByStatus(rows, "paused").map((r) => r.objectId).sort()).toEqual(["a2", "a3"]);
    expect(filterByStatus(rows, "active").map((r) => r.objectId)).toEqual(["a1"]);
    expect(filterByStatus(rows, "all")).toHaveLength(4);
    expect(countByStatus(rows)).toEqual({ all: 4, active: 1, paused: 2 });
  });
});

describe("buildCrmRows", () => {
  it("el nombre y el estado son los del CATALOGO, no los de la fila de metricas", () => {
    const [row] = buildCrmRows({
      rows: [adsRow({ objectName: "Nombre viejo", effectiveStatus: "PAUSED" })],
      level: "ad",
      metrics: [crm()],
      catalog: { a1: { name: "Nombre nuevo", effectiveStatus: "ACTIVE", thumbnailUrl: "https://x/t.png", creativeTitle: "Titulo" } },
    });
    expect(row).toMatchObject({ name: "Nombre nuevo", effectiveStatus: "ACTIVE", statusKind: "active", thumbnailUrl: "https://x/t.png", creativeTitle: "Titulo" });
  });

  it("un objeto solo con CRM (sin gasto en el periodo) aparece con el gasto en «—»", () => {
    const rows = buildCrmRows({ rows: [], level: "ad", metrics: [crm({ objectId: "solo-crm" })], catalog: { "solo-crm": { name: "Solo CRM", effectiveStatus: "PAUSED" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ objectId: "solo-crm", name: "Solo CRM", spend: null, hasMeta: false, leadsTotal: 4, roas: null, cplReal: null, cac: null });
  });

  it("un objeto con gasto y sin nada en el CRM: conteos en 0; ROAS 0 (se gasto y no volvio nada); los costos por unidad en «—»", () => {
    const [row] = buildCrmRows({ rows: [adsRow()], level: "ad", metrics: [], catalog: {} });
    expect(row).toMatchObject({ spend: 10, leadsTotal: 0, sales: 0, revenue: 0, cplReal: null, cac: null, costPerBooking: null, roas: 0, name: "Anuncio" });
  });

  it("la plata del CRM pasa de centavos a dolares", () => {
    const [row] = buildCrmRows({ rows: [adsRow({ spend: 320 })], level: "ad", metrics: [crm({ revenueCents: 200000, cashCents: 12345 })], catalog: {} });
    expect(row.revenue).toBe(2000);
    expect(row.cash).toBe(123.45);
    expect(row.roas).toBe(6.25);
  });

  it("junta solo las filas del nivel pedido", () => {
    const rows = buildCrmRows({ rows: [adsRow({ level: "campaign", objectId: "c1" }), adsRow({ level: "ad", objectId: "a1" })], level: "campaign", metrics: [], catalog: {} });
    expect(rows.map((r) => r.objectId)).toEqual(["c1"]);
  });

  it("las agendas de Meta salen del evento schedule; sin ese evento son «—»", () => {
    expect(scheduleCount([adsRow({ actions: { lead: 3 } })])).toBeNull();
    expect(scheduleCount([adsRow({ actions: { "offsite_conversion.fb_pixel_schedule": 2 } }), adsRow({ actions: { schedule_total: 3 } })])).toBe(5);
    const [row] = buildCrmRows({ rows: [adsRow({ actions: { schedule_total: 4 } })], level: "ad", metrics: [], catalog: {} });
    expect(row.bookingsMeta).toBe(4);
  });
});

describe("orden", () => {
  it("por gasto, despues por leads totales; sin gasto al final", () => {
    const base = buildCrmRows({
      rows: [adsRow({ objectId: "caro", spend: 100 }), adsRow({ objectId: "barato", spend: 5 }), adsRow({ objectId: "empate-a", spend: 5 })],
      level: "ad",
      metrics: [crm({ objectId: "barato", leadsTotal: 1 }), crm({ objectId: "empate-a", leadsTotal: 9 }), crm({ objectId: "solo-crm", leadsTotal: 50 })],
      catalog: {},
    });
    expect(base.map((r) => r.objectId)).toEqual(["caro", "empate-a", "barato", "solo-crm"]);
    expect(sortCrmRows(base).map((r) => r.objectId)).toEqual(base.map((r) => r.objectId));
  });
});

describe("totalRow", () => {
  const rows = buildCrmRows({
    rows: [adsRow({ objectId: "a1", spend: 100, impressions: 1000, clicks: 20, leads: 4 }), adsRow({ objectId: "a2", spend: 50, impressions: 4000, clicks: 20, leads: 1 })],
    level: "ad",
    metrics: [crm({ objectId: "a1", leadsTotal: 5, sales: 1, revenueCents: 100000, bookings: 3, leadsWithBooking: 2 }), crm({ objectId: "a2", leadsTotal: 5, sales: 0, revenueCents: 0, bookings: 1, leadsWithBooking: 1 })],
    catalog: {},
  });

  it("suma lo sumable", () => {
    const t = totalRow(rows);
    expect(t).toMatchObject({ spend: 150, impressions: 5000, clicks: 40, leadsMeta: 5, leadsTotal: 10, bookings: 4, sales: 1, revenue: 1000 });
  });

  it("los cocientes se calculan SOBRE los totales (no es el promedio de los de cada fila)", () => {
    const t = totalRow(rows);
    expect(t.ctr).toBe(0.8); // 40 / 5000
    expect(t.cplReal).toBe(15); // 150 / 10
    expect(t.roas).toBe(6.67); // 1000 / 150
    expect(t.cac).toBe(150); // 150 / 1
    // El promedio de los CTR de las filas (2 % y 0,5 %) seria 1,25: el total NO lo usa.
    expect(t.ctr).not.toBe(1.25);
  });

  it("el alcance y la frecuencia solo salen si se pasa el alcance unico real", () => {
    expect(totalRow(rows).reach).toBeNull();
    expect(totalRow(rows).frequency).toBeNull();
    expect(totalRow(rows, 2500)).toMatchObject({ reach: 2500, frequency: 2 });
  });

  it("sin filas no inventa ceros en lo de Meta", () => {
    const t = totalRow([]);
    expect(t.spend).toBeNull();
    expect(t.ctr).toBeNull();
    expect(t.roas).toBeNull();
    expect(t.leadsTotal).toBe(0);
  });
});
