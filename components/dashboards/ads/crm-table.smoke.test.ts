import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeTotals, type AdsRow } from "@/lib/dashboards/ads";
import { defaultPrefs, type ColumnPrefs } from "@/lib/dashboards/ads-columns";
import { EMPTY_CRM } from "@/lib/dashboards/ads-crm-load";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => "/" }));

vi.mock("@/lib/actions/ads-crm", () => ({
  loadCrmObjectReach: async () => ({ ok: false, reason: "unavailable", error: "x" }),
  loadCrmDistinctTotals: async () => ({ ok: false, error: "x" }),
  loadCrmCellDetail: async () => ({ ok: false, error: "x" }),
}));

let prefs: ColumnPrefs = defaultPrefs();
vi.mock("./use-column-prefs", () => ({ useColumnPrefs: () => [prefs, () => undefined] }));

const { CrmLevelTable } = await import("./crm-table");

const row: AdsRow = {
  level: "campaign", objectId: "lp1", objectName: "Imagenes - LP1", parentName: null, campaignId: "lp1", adsetId: null, date: "2026-10-08",
  spend: 100, impressions: 59454, reach: 49545, clicks: 20, outboundClicks: null, linkClicks: null, leads: 4, purchases: null, purchaseValue: null,
  status: null, effectiveStatus: null, qualityRanking: null, engagementRanking: null, conversionRanking: null,
  videoP25: null, videoP50: null, videoP75: null, videoP95: null, videoP100: null, thruplays: null, videoAvgTimeSeconds: null,
  actions: {}, updatedAt: null,
};

const render = () =>
  renderToStaticMarkup(
    createElement(CrmLevelTable, {
      level: "campaign",
      rows: [row],
      totals: computeTotals([row]),
      crm: { ...EMPTY_CRM, since: "2026-10-08", until: "2026-11-06", adAccountId: "act_1" },
      currency: "USD",
      hrefOf: (id: string) => `/x/${id}`,
    }),
  );

beforeEach(() => {
  prefs = defaultPrefs();
});

describe("Alcance y Frec. en la tabla Meta vs CRM", () => {
  it("por defecto estan ocultas: la tabla no las dibuja", () => {
    const html = render();
    expect(html).not.toContain("Alcance");
    expect(html).not.toContain("49.545");
    expect(html).not.toContain("≈");
  });

  it("a la vista, mientras Meta contesta muestra «…» y nunca la suma como si fuera el dato", () => {
    prefs = { ...prefs, visible: [...prefs.visible, "reach", "frequency"] };
    const html = render();
    expect(html).toContain("Alcance");
    expect(html).toContain("Preguntándole a Meta");
    expect(html).not.toContain("49.545");
    expect(html).not.toContain("≈");
  });
});
