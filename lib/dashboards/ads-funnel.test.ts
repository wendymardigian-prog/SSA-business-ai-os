import { describe, expect, it } from "vitest";
import { computeTotals, type AdsRow } from "./ads";
import {
  ACTION_KEYS,
  formatFunnelDrop,
  formatFunnelPercent,
  funnelKindFor,
  funnelNotes,
  funnelSteps,
  resolveFunnelKind,
  sumActions,
  type FunnelCrm,
  type FunnelKind,
} from "./ads-funnel";

const row = (over: Partial<AdsRow>): AdsRow => ({
  level: "ad",
  objectId: "1",
  objectName: null,
  parentName: null,
  campaignId: null,
  adsetId: null,
  date: "2026-10-01",
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

const NO_CRM: FunnelCrm = { leadsTotal: 0, bookings: 0, sales: 0 };

function stepsOf(kind: FunnelKind, rows: AdsRow[], crm: FunnelCrm | null = NO_CRM) {
  return funnelSteps({ kind, totals: computeTotals(rows), actions: sumActions(rows), crm }) ?? [];
}
const table = (steps: ReturnType<typeof stepsOf>) => steps.map((s) => [s.label, s.value, s.percent, s.base]);

describe("qué funnel corresponde", () => {
  it("manda la optimización del AdSet", () => {
    expect(funnelKindFor("PROFILE_VISIT", "OUTCOME_TRAFFIC")).toBe("profile");
    expect(funnelKindFor("VISIT_INSTAGRAM_PROFILE", "LINK_CLICKS")).toBe("profile");
    expect(funnelKindFor("LANDING_PAGE_VIEWS", "OUTCOME_TRAFFIC")).toBe("traffic");
    expect(funnelKindFor("CONVERSATIONS", "OUTCOME_ENGAGEMENT")).toBe("messages");
    expect(funnelKindFor("LEAD_GENERATION", "OUTCOME_ENGAGEMENT")).toBe("leads");
  });

  it("una conversión la define el objetivo de la campaña", () => {
    expect(funnelKindFor("OFFSITE_CONVERSIONS", "OUTCOME_LEADS")).toBe("leads");
    expect(funnelKindFor("OFFSITE_CONVERSIONS", "OUTCOME_SALES")).toBe("sales");
    expect(funnelKindFor("ONSITE_CONVERSIONS", "CONVERSIONS")).toBe("generic");
    expect(funnelKindFor(null, null)).toBe("generic");
  });

  it("una campaña con AdSets que optimizan distinto usa el general y dice qué mezcla", () => {
    expect(resolveFunnelKind({ goals: ["PROFILE_VISIT", "PROFILE_VISIT"], objective: "OUTCOME_TRAFFIC" })).toEqual({ kind: "profile", mixed: [] });
    expect(resolveFunnelKind({ goals: ["PROFILE_VISIT", "LINK_CLICKS"], objective: "OUTCOME_TRAFFIC" })).toEqual({ kind: "generic", mixed: ["profile", "traffic"] });
    expect(resolveFunnelKind({ goals: [], objective: "OUTCOME_LEADS" })).toEqual({ kind: "leads", mixed: [] });
  });
});

describe("los pasos de Meta según el funnel", () => {
  it("visitas al perfil: el resultado de Meta, no los clics salientes", () => {
    const rows = [row({ impressions: 10000, outboundClicks: 40, clicks: 400, actions: { [ACTION_KEYS.profileVisits]: 500, [ACTION_KEYS.conversations]: 20 } })];
    expect(table(stepsOf("profile", rows))).toEqual([
      ["Impresiones", 10000, 100, null],
      ["Visitas al perfil", 500, 5, "impressions"],
      ["Conversaciones", 20, 4, "profileVisits"],
    ]);
  });

  it("visitas al perfil sin el dato guardado: el paso queda sin número y la nota lo explica", () => {
    const steps = stepsOf("profile", [row({ impressions: 1000 })]);
    expect(steps[1]).toMatchObject({ key: "profileVisits", value: null, percent: null });
    expect(funnelNotes({ kind: "profile", mixed: [], steps, crm: NO_CRM, crmFailed: false }).join(" ")).toContain("visitas al perfil");
  });

  it("tráfico: clics en el enlace y visitas a la página", () => {
    const rows = [row({ impressions: 1000, actions: { link_click: 100, landing_page_view: 40 } })];
    expect(table(stepsOf("traffic", rows))).toEqual([
      ["Impresiones", 1000, 100, null],
      ["Clics en el enlace", 100, 10, "impressions"],
      ["Visitas a la página", 40, 40, "linkClicks"],
    ]);
  });

  it("un paso opcional en cero no se muestra", () => {
    expect(stepsOf("traffic", [row({ impressions: 1000, actions: { link_click: 100 } })]).map((s) => s.key)).toEqual(["impressions", "linkClicks"]);
  });

  it("reconocimiento, video e interacción tienen su paso", () => {
    expect(stepsOf("awareness", [row({ impressions: 1000, reach: 600 })])[1]).toMatchObject({ label: "Alcance", value: 600 });
    expect(stepsOf("video", [row({ impressions: 1000, actions: { video_view: 300 } })])[1]).toMatchObject({ label: "Reproducciones", value: 300 });
    expect(stepsOf("engagement", [row({ impressions: 1000, actions: { post_engagement: 90 } })])[1]).toMatchObject({ label: "Interacciones", value: 90 });
  });

  it("los clics dicen si son salientes o todos", () => {
    const outbound = stepsOf("generic", [row({ impressions: 10, outboundClicks: 2, clicks: 5 })]);
    const all = stepsOf("generic", [row({ impressions: 10, clicks: 5 })]);
    expect(outbound[1]).toMatchObject({ value: 2 });
    expect(outbound[1].tip).toContain("salientes");
    expect(all[1]).toMatchObject({ value: 5 });
    expect(all[1].tip).toContain("Todos los clics");
  });

  it("sin impresiones no hay funnel; sin leads sí", () => {
    expect(funnelSteps({ kind: "generic", totals: computeTotals([row({})]), actions: {}, crm: NO_CRM })).toBeNull();
    expect(stepsOf("awareness", [row({ impressions: 100, reach: 80 })]).length).toBe(2);
  });
});

describe("leads, agendas y ventas: iguales en todos los funnels", () => {
  it("Leads Meta y Leads CRM se comparan contra el mismo paso, no uno contra el otro", () => {
    const rows = [row({ impressions: 10000, leads: 39, actions: { [ACTION_KEYS.profileVisits]: 500 } })];
    expect(table(stepsOf("profile", rows, { leadsTotal: 81, bookings: 0, sales: 0 }))).toEqual([
      ["Impresiones", 10000, 100, null],
      ["Visitas al perfil", 500, 5, "impressions"],
      ["Leads Meta", 39, 7.8, "profileVisits"],
      ["Leads CRM", 81, 16.2, "profileVisits"],
    ]);
  });

  it("tráfico a la web también puede tener leads", () => {
    const rows = [row({ impressions: 1000, leads: 5, actions: { link_click: 100, landing_page_view: 50 } })];
    expect(stepsOf("traffic", rows, { leadsTotal: 4, bookings: 0, sales: 0 }).map((s) => s.label)).toEqual([
      "Impresiones",
      "Clics en el enlace",
      "Visitas a la página",
      "Leads Meta",
      "Leads CRM",
    ]);
  });

  it("agendas y ventas se calculan sobre el CRM", () => {
    const rows = [row({ impressions: 1000, outboundClicks: 100, leads: 10 })];
    expect(table(stepsOf("leads", rows, { leadsTotal: 8, bookings: 4, sales: 1 })).slice(2)).toEqual([
      ["Leads Meta", 10, 10, "clicks"],
      ["Leads CRM", 8, 8, "clicks"],
      ["Agendas", 4, 50, "leadsCrm"],
      ["Ventas", 1, 25, "bookings"],
    ]);
  });

  it("sin agendas, las ventas van contra los leads del CRM", () => {
    const rows = [row({ impressions: 1000, outboundClicks: 100 })];
    const steps = stepsOf("generic", rows, { leadsTotal: 8, bookings: 0, sales: 2 });
    expect(steps.map((s) => s.label)).toEqual(["Impresiones", "Clics", "Leads CRM", "Ventas"]);
    expect(steps[3]).toMatchObject({ percent: 25, base: "leadsCrm" });
  });

  it("un funnel de leads muestra los Leads Meta aunque sean cero; otro funnel, solo si hubo", () => {
    const rows = [row({ impressions: 1000, outboundClicks: 100 })];
    expect(stepsOf("leads", rows).map((s) => s.key)).toContain("leadsMeta");
    expect(stepsOf("generic", rows).map((s) => s.key)).toEqual(["impressions", "clicks"]);
  });

  it("las compras de Meta van contra sus leads, al lado de las ventas", () => {
    const rows = [row({ impressions: 100, clicks: 10, leads: 5, purchases: 1 })];
    expect(stepsOf("sales", rows, { leadsTotal: 5, bookings: 0, sales: 1 }).slice(-2).map((s) => [s.label, s.percent, s.base])).toEqual([
      ["Compras Meta", 20, "leadsMeta"],
      ["Ventas", 20, "leadsCrm"],
    ]);
  });

  it("sin datos del CRM no hay pasos del CRM", () => {
    const rows = [row({ impressions: 1000, outboundClicks: 100, leads: 10 })];
    expect(stepsOf("leads", rows, null).map((s) => s.key)).toEqual(["impressions", "clicks", "leadsMeta"]);
  });

  it("cada paso explica de donde sale", () => {
    const rows = [row({ impressions: 1000, outboundClicks: 100, leads: 10 })];
    const steps = stepsOf("leads", rows, { leadsTotal: 8, bookings: 4, sales: 1 });
    expect(steps.every((s) => s.tip.length > 20)).toBe(true);
    expect(steps.find((s) => s.key === "leadsMeta")?.tip).toContain("reporta Meta");
    expect(steps.find((s) => s.key === "leadsCrm")?.tip).toContain("CRM");
  });
});

describe("las notas", () => {
  const steps = stepsOf("generic", [row({ impressions: 100, clicks: 10 })]);

  it("dicen por qué falta un paso", () => {
    expect(funnelNotes({ kind: "generic", mixed: [], steps, crm: { leadsTotal: 3, bookings: 0, sales: 0 }, crmFailed: false })).toEqual(["Sin agendas ni ventas atribuidas en este período."]); // @plantilla-quitar(ventas)
    expect(funnelNotes({ kind: "generic", mixed: [], steps, crm: { leadsTotal: 3, bookings: 2, sales: 1 }, crmFailed: false })).toEqual([]);
    expect(funnelNotes({ kind: "generic", mixed: [], steps, crm: null, crmFailed: true })[0]).toContain("No pude leer");
  });

  it("avisan cuando una campaña mezcla objetivos", () => {
    expect(funnelNotes({ kind: "generic", mixed: ["profile", "traffic"], steps, crm: { leadsTotal: 0, bookings: 1, sales: 1 }, crmFailed: false })[0]).toContain("Visitas al perfil, Tráfico a la web");
  });
});

it("un porcentaje chico no se lee como cero ni como una caída del 100 %", () => {
  expect(formatFunnelPercent(0.02)).toBe("<0.1%");
  expect(formatFunnelDrop(0.02)).toBe(">99.9%");
  expect(formatFunnelPercent(2.5)).toBe("2.5%");
  expect(formatFunnelDrop(2.5)).toBe("97.5%");
});
