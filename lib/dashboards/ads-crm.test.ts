import { describe, expect, it } from "vitest";
import type { AdsRow } from "./ads";
import {
  buildCrmRows,
  countByStatus,
  crmRatios,
  filterByStatus,
  publicationUrlOf,
  resolveRowInfo,
  scheduleCount,
  showNoAdSignalNotice,
  sortCrmRows,
  statusKind,
  totalFootnote,
  totalRow,
  totalRowDetailed,
  type CrmMetrics,
} from "./ads-crm";

const adsRow = (over: Partial<AdsRow> = {}): AdsRow => ({
  level: "ad", objectId: "a1", objectName: "Anuncio", parentName: "Conjunto", campaignId: "c1", adsetId: "s1", date: "2026-10-01",
  spend: 10, impressions: 1000, reach: 800, clicks: 20, outboundClicks: 15, linkClicks: 15, leads: 2, purchases: 0, purchaseValue: 0,
  status: "ACTIVE", effectiveStatus: null, qualityRanking: null, engagementRanking: null, conversionRanking: null,
  videoP25: null, videoP50: null, videoP75: null, videoP95: null, videoP100: null, thruplays: null, videoAvgTimeSeconds: null,
  actions: {}, updatedAt: null, ...over,
});

const crm = (over: Partial<CrmMetrics> = {}): CrmMetrics => ({
  objectId: "a1", leadsNew: 1, leadsTotal: 4, leadsWithBooking: 2, bookings: 2, bookingsAttended: 1, sales: 1, revenueCents: 200000, cashCents: 50000, ufCashCents: 20000, ...over,
});

const ratiosInput = (over: Partial<Parameters<typeof crmRatios>[0]> = {}) => ({
  spend: 100, leadsNew: 0, leadsTotal: 0, leadsWithBooking: 0, bookings: 0, attended: 0, sales: 0, revenue: 0, cash: 0, ufCash: 0, ...over,
});

describe("crmRatios (division por cero = «—»)", () => {
  it("el ejemplo del alcance: costo por agenda 53,33 y ROAS 6,25", () => {
    const r = crmRatios(ratiosInput({ spend: 320, leadsTotal: 8, leadsWithBooking: 3, bookings: 6, sales: 1, revenue: 2000, cash: 500 }));
    expect(r.costPerBooking).toBe(53.33);
    expect(r.roas).toBe(6.25);
    expect(r.roasCash).toBe(1.56);
    expect(r.leadToBooking).toBe(37.5);
  });

  it("CPL nuevo y CPL total son DOS cuentas: gasto ÷ leads nuevos y gasto ÷ leads totales", () => {
    const r = crmRatios(ratiosInput({ spend: 120, leadsNew: 4, leadsTotal: 10 }));
    expect(r.cplNew).toBe(30);
    expect(r.cplTotal).toBe(12);
  });

  it("sin leads nuevos el CPL nuevo es «—», no 0 (y el total puede existir)", () => {
    const r = crmRatios(ratiosInput({ spend: 50, leadsNew: 0, leadsTotal: 5 }));
    expect(r.cplNew).toBeNull();
    expect(r.cplTotal).toBe(10);
  });

  it("ROAS con gasto 0 o sin gasto es «—»", () => {
    expect(crmRatios(ratiosInput({ spend: 0, revenue: 100 })).roas).toBeNull();
    expect(crmRatios(ratiosInput({ spend: null, revenue: 100 })).roas).toBeNull();
    expect(crmRatios(ratiosInput({ spend: 0, ufCash: 10 })).ufRoas).toBeNull();
  });

  it("sin ventas, agendas o asistidas, los costos por unidad son «—»", () => {
    const r = crmRatios(ratiosInput({ spend: 100 }));
    expect(r.costPerNewDeal).toBeNull();
    expect(r.costPerBooking).toBeNull();
    expect(r.costPerAttended).toBeNull();
  });

  it("el costo por nuevo deal es gasto ÷ ventas (CAC y Costo por cierre eran lo mismo)", () => {
    expect(crmRatios(ratiosInput({ spend: 300, sales: 2 })).costPerNewDeal).toBe(150);
  });

  it("UF ROAS = primer pago cobrado ÷ gasto; costo por asistida = gasto ÷ asistidas", () => {
    const r = crmRatios(ratiosInput({ spend: 200, ufCash: 100, attended: 4 }));
    expect(r.ufRoas).toBe(0.5);
    expect(r.costPerAttended).toBe(50);
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
    expect(rows[0]).toMatchObject({ objectId: "solo-crm", name: "Solo CRM", spend: null, hasMeta: false, leadsTotal: 4, roas: null, cplNew: null, cplTotal: null, costPerNewDeal: null });
  });

  it("un objeto con gasto y sin nada en el CRM: conteos en 0; ROAS 0 (se gasto y no volvio nada); los costos por unidad en «—»", () => {
    const [row] = buildCrmRows({ rows: [adsRow()], level: "ad", metrics: [], catalog: {} });
    expect(row).toMatchObject({ spend: 10, leadsNew: 0, leadsTotal: 0, sales: 0, revenue: 0, cplNew: null, cplTotal: null, costPerNewDeal: null, costPerBooking: null, roas: 0, name: "Anuncio" });
  });

  it("la plata del CRM pasa de centavos a dolares (revenue, cash y primer pago)", () => {
    const [row] = buildCrmRows({ rows: [adsRow({ spend: 320 })], level: "ad", metrics: [crm({ revenueCents: 200000, cashCents: 12345, ufCashCents: 8000 })], catalog: {} });
    expect(row.revenue).toBe(2000);
    expect(row.cash).toBe(123.45);
    expect(row.ufCash).toBe(80);
    expect(row.roas).toBe(6.25);
    expect(row.ufRoas).toBe(0.25);
  });

  it("junta solo las filas del nivel pedido", () => {
    const rows = buildCrmRows({ rows: [adsRow({ level: "campaign", objectId: "c1" }), adsRow({ level: "ad", objectId: "a1" })], level: "campaign", metrics: [], catalog: {} });
    expect(rows.map((r) => r.objectId)).toEqual(["c1"]);
  });

  it("las agendas de Meta salen del evento schedule (UN nombre por dia); sin ese evento son «—»", () => {
    expect(scheduleCount([adsRow({ actions: { lead: 3 } })])).toBeNull();
    expect(scheduleCount([adsRow({ actions: { "offsite_conversion.fb_pixel_schedule": 2 } }), adsRow({ actions: { schedule_total: 3 } })])).toBe(5);
    // El mismo evento con tres nombres el mismo dia cuenta UNA vez.
    expect(scheduleCount([adsRow({ actions: { omni_schedule: 4, "offsite_conversion.fb_pixel_schedule": 4, schedule_total: 4 } })])).toBe(4);
    const [row] = buildCrmRows({ rows: [adsRow({ actions: { schedule_total: 4 } })], level: "ad", metrics: [], catalog: {} });
    expect(row.bookingsMeta).toBe(4);
  });

  it("las columnas nuevas de Meta salen de lo que ya se guarda y los cocientes de los contadores", () => {
    const [row] = buildCrmRows({
      rows: [
        adsRow({ spend: 100, impressions: 1000, purchases: null, purchaseValue: null, linkClicks: 50, thruplays: 20, videoP25: 60, videoP100: 10, actions: { video_view: 200, omni_view_content: 30 }, videoAvgTimeSeconds: 8, qualityRanking: "ABOVE_AVERAGE" }),
      ],
      level: "ad",
      metrics: [],
      catalog: {},
    });
    expect(row).toMatchObject({ linkClicks: 50, linkCtr: 5, linkCpc: 2, video3s: 200, hookRate: 20, costPerVideo3s: 0.5, thruplays: 20, holdRate: 10, retention25: 30, retention100: 5, avgWatchSeconds: 8, viewContent: 30, costPerViewContent: 3.33, qualityRanking: "ABOVE_AVERAGE" });
    // Lo que Meta no manda es «—», no 0.
    expect(row.applications).toBeNull();
    expect(row.costPerApplication).toBeNull();
    expect(row.purchases).toBeNull();
  });

  it("«# anuncios» cuenta los del catalogo y los que tuvieron metricas, sin repetir", () => {
    const rows = buildCrmRows({
      rows: [adsRow({ level: "campaign", objectId: "c1", objectName: "Camp" }), adsRow({ level: "ad", objectId: "a1", campaignId: "c1" })],
      level: "campaign",
      metrics: [],
      catalog: {},
      adLinks: [{ adId: "a1", adsetId: "s1", campaignId: "c1" }, { adId: "a2", adsetId: "s1", campaignId: "c1" }, { adId: "otro", adsetId: "s9", campaignId: "c9" }],
    });
    expect(rows[0].adsCount).toBe(2);
  });
});

describe("resolveRowInfo: el catalogo manda y los insights son el respaldo (Tirón 2, E1)", () => {
  const names = { campaign: new Map([["c1", "Campaña de los insights"]]), adset: new Map([["s1", "Conjunto de los insights"]]) };
  const group = { objectId: "a1", objectName: "Anuncio de los insights", parentName: "Conjunto del insight", campaignId: "c1", adsetId: "s1", status: null } as never;

  it("con catalogo: usa lo del catalogo", () => {
    const info = resolveRowInfo({
      level: "ad", objectId: "a1", names, adLinks: [], group,
      catalog: { name: "Anuncio del catalogo", effectiveStatus: "ACTIVE", adsetName: "Conjunto del catalogo", campaignName: "Campaña del catalogo" },
    });
    expect(info).toMatchObject({ name: "Anuncio del catalogo", effectiveStatus: "ACTIVE", adsetName: "Conjunto del catalogo", campaignName: "Campaña del catalogo", parentName: "Conjunto del catalogo" });
  });

  it("SIN catalogo: nombre, conjunto y campaña salen de los insights; el estado queda null", () => {
    const info = resolveRowInfo({ level: "ad", objectId: "a1", names, adLinks: [], group, catalog: null });
    expect(info).toMatchObject({ name: "Anuncio de los insights", adsetName: "Conjunto del insight", campaignName: "Campaña de los insights", effectiveStatus: null });
  });

  it("MEZCLADO: lo que el catalogo tiene manda y lo que le falta sale de los insights", () => {
    const info = resolveRowInfo({ level: "ad", objectId: "a1", names, adLinks: [], group, catalog: { name: "Anuncio del catalogo", effectiveStatus: "PAUSED" } });
    expect(info).toMatchObject({ name: "Anuncio del catalogo", effectiveStatus: "PAUSED", adsetName: "Conjunto del insight", campaignName: "Campaña de los insights" });
  });

  it("un conjunto: su padre es la campaña; una campaña no tiene padre", () => {
    const adsetGroup = { objectId: "s1", objectName: "Conjunto", parentName: "Campaña X", campaignId: "c1", adsetId: "s1", status: null } as never;
    expect(resolveRowInfo({ level: "adset", objectId: "s1", names, adLinks: [], group: adsetGroup, catalog: null })).toMatchObject({ campaignName: "Campaña X", adsetName: "Conjunto", parentName: "Campaña X" });
    const campaignGroup = { objectId: "c1", objectName: "Campaña", parentName: null, campaignId: "c1", adsetId: null, status: null } as never;
    expect(resolveRowInfo({ level: "campaign", objectId: "c1", names, adLinks: [], group: campaignGroup, catalog: null })).toMatchObject({ campaignName: "Campaña", adsetName: null, parentName: null });
  });

  it("sin catalogo ni insights de ese objeto (solo CRM), todo null y no lanza", () => {
    expect(resolveRowInfo({ level: "ad", objectId: "x", names, adLinks: [], group: null, catalog: null })).toMatchObject({ name: null, effectiveStatus: null, campaignName: null, adsetName: null });
  });
});

describe("publicationUrlOf", () => {
  it("la direccion del posteo de Contenido gana; si no, la de Facebook que arma el id del posteo", () => {
    expect(publicationUrlOf({ socialPostUrl: "https://instagram.com/p/abc", objectStoryId: "123_456" })).toBe("https://instagram.com/p/abc");
    expect(publicationUrlOf({ objectStoryId: "123_456" })).toBe("https://www.facebook.com/123/posts/456");
  });

  it("sin nada que se pueda armar es null (Instagram sin vinculo no tiene direccion sin llamar a Meta)", () => {
    expect(publicationUrlOf({})).toBeNull();
    expect(publicationUrlOf({ objectStoryId: "no-es-un-id" })).toBeNull();
    expect(publicationUrlOf({ socialPostUrl: "javascript:alert(1)" })).toBeNull();
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
    metrics: [crm({ objectId: "a1", leadsNew: 2, leadsTotal: 5, sales: 1, revenueCents: 100000, bookings: 3, leadsWithBooking: 2 }), crm({ objectId: "a2", leadsNew: 3, leadsTotal: 5, sales: 0, revenueCents: 0, bookings: 1, leadsWithBooking: 1 })],
    catalog: {},
  });

  it("suma lo sumable", () => {
    const t = totalRow(rows);
    expect(t).toMatchObject({ spend: 150, impressions: 5000, clicks: 40, leadsMeta: 5, leadsNew: 5, bookings: 4, sales: 1, revenue: 1000 });
  });

  it("los cocientes se calculan SOBRE los totales (no es el promedio de los de cada fila)", () => {
    const t = totalRow(rows);
    expect(t.ctr).toBe(0.8); // 40 / 5000
    expect(t.cplNew).toBe(30); // 150 / 5 leads nuevos
    expect(t.roas).toBe(6.67); // 1000 / 150
    expect(t.costPerNewDeal).toBe(150); // 150 / 1
    // El promedio de los CTR de las filas (2 % y 0,5 %) seria 1,25: el total NO lo usa.
    expect(t.ctr).not.toBe(1.25);
  });

  it("el alcance y la frecuencia solo salen si se pasa el alcance unico real", () => {
    expect(totalRow(rows).reach).toBeNull();
    expect(totalRow(rows).frequency).toBeNull();
    expect(totalRow(rows, 2500)).toMatchObject({ reach: 2500, frequency: 2 });
    expect(totalRow(rows, { overallReach: 2500 })).toMatchObject({ reach: 2500, frequency: 2 });
  });

  it("sin filas no inventa ceros en lo de Meta", () => {
    const t = totalRow([]);
    expect(t.spend).toBeNull();
    expect(t.ctr).toBeNull();
    expect(t.roas).toBeNull();
    expect(t.leadsTotal).toBe(0);
  });

  it("los contadores nuevos se suman y sus cocientes se recalculan con los totales (hook rate total = Σ reprod. 3 s ÷ Σ impresiones)", () => {
    const video = buildCrmRows({
      rows: [
        adsRow({ objectId: "a1", spend: 10, impressions: 1000, actions: { video_view: 500 } }),
        adsRow({ objectId: "a2", spend: 10, impressions: 9000, actions: { video_view: 100 } }),
      ],
      level: "ad", metrics: [], catalog: {},
    });
    const t = totalRow(video);
    expect(t.video3s).toBe(600);
    expect(t.hookRate).toBe(6); // 600 / 10000, NO el promedio de 50 % y 1,11 %
    expect(t.costPerVideo3s).toBe(0.03);
  });

  it("el tiempo promedio visto del total pesa cada fila por sus reproducciones", () => {
    const video = buildCrmRows({
      rows: [
        adsRow({ objectId: "a1", actions: { video_view: 100 }, videoAvgTimeSeconds: 10 }),
        adsRow({ objectId: "a2", actions: { video_view: 300 }, videoAvgTimeSeconds: 2 }),
      ],
      level: "ad", metrics: [], catalog: {},
    });
    expect(totalRow(video).avgWatchSeconds).toBe(4); // (10·100 + 2·300) / 400
  });

  it("los rankings no se suman: en el total son null", () => {
    const r = buildCrmRows({ rows: [adsRow({ qualityRanking: "AVERAGE" })], level: "ad", metrics: [], catalog: {} });
    expect(totalRow(r).qualityRanking).toBeNull();
  });
});

describe("la fila de total no cuenta dos veces a nadie (Tirón 2, B3)", () => {
  it("1 contacto que toco 2 anuncios, gasto 100: Leads totales del Total = 1 y CPL total = 100", () => {
    // El mismo contacto aparece en los dos anuncios (leadsTotal 1 en cada uno): la suma de las filas daria 2.
    const rows = buildCrmRows({
      rows: [adsRow({ objectId: "a1", spend: 60 }), adsRow({ objectId: "a2", spend: 40 })],
      level: "ad",
      metrics: [crm({ objectId: "a1", leadsNew: 1, leadsTotal: 1, leadsWithBooking: 0, bookings: 0, sales: 0, revenueCents: 0 }), crm({ objectId: "a2", leadsNew: 0, leadsTotal: 1, leadsWithBooking: 0, bookings: 0, sales: 0, revenueCents: 0 })],
      catalog: {},
    });
    const sum = totalRowDetailed(rows);
    expect(sum.row.leadsTotal).toBe(2);
    expect(sum.leadsTotalIsSum).toBe(true);

    const distinct = totalRowDetailed(rows, { distinctLeads: { leadsTotal: 1, leadsWithBooking: 0 } });
    expect(distinct.row.leadsTotal).toBe(1);
    expect(distinct.row.cplTotal).toBe(100);
    expect(distinct.leadsTotalIsSum).toBe(false);
    // Leads nuevos SI se suman y es exacto: cada persona tiene un solo primer toque.
    expect(distinct.row.leadsNew).toBe(1);
    expect(distinct.row.cplNew).toBe(100);
  });

  it("Lead → Agenda del total usa personas distintas en los dos lados", () => {
    const rows = buildCrmRows({
      rows: [adsRow({ objectId: "a1" }), adsRow({ objectId: "a2" })],
      level: "ad",
      metrics: [crm({ objectId: "a1", leadsTotal: 2, leadsWithBooking: 1 }), crm({ objectId: "a2", leadsTotal: 2, leadsWithBooking: 1 })],
      catalog: {},
    });
    // 3 personas distintas, 1 con agenda (la misma persona agendo por los dos anuncios).
    expect(totalRow(rows, { distinctLeads: { leadsTotal: 3, leadsWithBooking: 1 } }).leadToBooking).toBe(33.33);
    expect(totalRow(rows).leadToBooking).toBe(50);
  });

  it("agendas, ventas y revenue se SUMAN y es exacto", () => {
    const rows = buildCrmRows({
      rows: [adsRow({ objectId: "a1" }), adsRow({ objectId: "a2" })],
      level: "ad",
      metrics: [crm({ objectId: "a1", bookings: 2, sales: 1, revenueCents: 100000 }), crm({ objectId: "a2", bookings: 3, sales: 2, revenueCents: 50000 })],
      catalog: {},
    });
    expect(totalRow(rows, { distinctLeads: { leadsTotal: 1, leadsWithBooking: 1 } })).toMatchObject({ bookings: 5, sales: 3, revenue: 1500 });
  });

  it("la nota al pie dice lo que hace el total, segun si cuenta distintos o suma", () => {
    expect(totalFootnote(false)).toContain("una sola vez");
    expect(totalFootnote(true)).toContain("puede contar dos veces");
    expect(totalFootnote(false)).not.toContain("un contacto que tocó dos anuncios cuenta en cada uno");
  });
});

describe("el aviso «ningún contacto trae datos de anuncio» (Tirón 2, E1)", () => {
  const rowsWith = (metrics: CrmMetrics[]) => totalRow(buildCrmRows({ rows: [adsRow({ spend: 100 })], level: "ad", metrics, catalog: {} }));

  it("aparece cuando hay gasto y el CRM no cuenta nada de ningun anuncio", () => {
    expect(showNoAdSignalNotice(rowsWith([]))).toBe(true);
    expect(showNoAdSignalNotice(rowsWith([crm({ leadsNew: 0, leadsTotal: 0, bookings: 0, sales: 0 })]))).toBe(true);
  });

  it("no aparece si hay un lead, una agenda o una venta", () => {
    expect(showNoAdSignalNotice(rowsWith([crm({ leadsNew: 0, leadsTotal: 1, bookings: 0, sales: 0 })]))).toBe(false);
    expect(showNoAdSignalNotice(rowsWith([crm({ leadsNew: 0, leadsTotal: 0, bookings: 1, sales: 0 })]))).toBe(false);
    expect(showNoAdSignalNotice(rowsWith([crm({ leadsNew: 0, leadsTotal: 0, bookings: 0, sales: 1 })]))).toBe(false);
  });

  it("no aparece sin gasto (no hay nada que vincular)", () => {
    expect(showNoAdSignalNotice(totalRow(buildCrmRows({ rows: [], level: "ad", metrics: [], catalog: {} })))).toBe(false);
  });
});

describe("crmLeadsSummary (la tarjeta «Leads CRM»)", () => {
  it("nuevos = suma de las campañas (exacto); totales = personas distintas; los dos CPL", async () => {
    const { crmLeadsSummary } = await import("./ads-crm");
    const metrics = [crm({ objectId: "c1", leadsNew: 4, leadsTotal: 6 }), crm({ objectId: "c2", leadsNew: 2, leadsTotal: 6 })];
    const s = crmLeadsSummary({ metrics, distinct: { leadsTotal: 8, leadsWithBooking: 2 }, spend: 240 });
    expect(s).toMatchObject({ leadsNew: 6, leadsTotal: 8, cplNew: 40, cplTotal: 30, leadsTotalIsSum: false });
  });

  it("sin la fila de distintos, los totales son la suma de las campañas y se avisa", async () => {
    const { crmLeadsSummary } = await import("./ads-crm");
    const s = crmLeadsSummary({ metrics: [crm({ leadsNew: 1, leadsTotal: 2 }), crm({ objectId: "c2", leadsNew: 1, leadsTotal: 2 })], distinct: null, spend: 40 });
    expect(s).toMatchObject({ leadsTotal: 4, leadsTotalIsSum: true });
  });

  it("sin gasto o sin leads los CPL son «—», no 0", async () => {
    const { crmLeadsSummary } = await import("./ads-crm");
    expect(crmLeadsSummary({ metrics: [], distinct: null, spend: 100 })).toMatchObject({ leadsNew: 0, leadsTotal: 0, cplNew: null, cplTotal: null });
    expect(crmLeadsSummary({ metrics: [crm()], distinct: null, spend: null })).toMatchObject({ cplNew: null, cplTotal: null });
  });
});
