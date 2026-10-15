import { describe, expect, it } from "vitest";
import { computeTotals } from "@/lib/dashboards/ads";
import { buildKpiItems } from "./kpi-items";

const totals = computeTotals([
  { level: "account", objectId: "act", objectName: null, parentName: null, campaignId: null, adsetId: null, date: "2026-10-01", spend: 300, impressions: 10000, reach: 5000, clicks: 100, outboundClicks: null, linkClicks: null, leads: 6, purchases: null, purchaseValue: null, status: null, effectiveStatus: null, qualityRanking: null, engagementRanking: null, conversionRanking: null, videoP25: null, videoP50: null, videoP75: null, videoP95: null, videoP100: null, thruplays: null, videoAvgTimeSeconds: null, actions: {}, updatedAt: null },
]);

describe("las tarjetas de arriba del dashboard de Ads", () => {
  it("la de Meta se llama «Leads Meta» (para no confundirla con la del CRM)", () => {
    const items = buildKpiItems({ totals, previous: null, currency: "USD" });
    expect(items).toHaveLength(8);
    expect(items.find((i) => i.key === "leads")!.label).toBe("Leads Meta");
  });

  it("con datos del CRM suma «Leads CRM»: nuevos · totales y los DOS CPL juntos, con su explicacion", () => {
    const items = buildKpiItems({ totals, previous: null, currency: "USD", crmLeads: { leadsNew: 10, leadsTotal: 20, cplNew: 30, cplTotal: 15, leadsTotalIsSum: false } });
    expect(items).toHaveLength(9);
    const card = items[8];
    expect(card.label).toBe("Leads CRM");
    expect(card.value).toBe("10 · 20");
    expect(card.sub).toContain("nuevo");
    expect(card.sub).toContain("total");
    expect(card.sub).toMatch(/30/);
    expect(card.sub).toMatch(/15/);
    expect(card.tip).toMatch(/primer contacto/);
  });

  it("sin leads el CPL es «—» y no 0", () => {
    const items = buildKpiItems({ totals, previous: null, currency: "USD", crmLeads: { leadsNew: 0, leadsTotal: 0, cplNew: null, cplTotal: null, leadsTotalIsSum: false } });
    expect(items[8].sub).toBe("CPL — nuevo · — total");
  });
});
