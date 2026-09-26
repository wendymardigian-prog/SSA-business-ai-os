/**
 * El contexto para analizar anuncios con IA (F61).
 */

import { describe, it, expect } from "vitest";
import type { AdsRow } from "@/lib/dashboards/ads";
import { buildAnalysisContext, hasSomethingToAnalyze, MAX_CAMPAIGNS } from "./ai-analysis";

const row = (over: Partial<AdsRow> & { level: string; objectId: string; date: string }): AdsRow => ({
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
  ...over,
});

describe("el contexto (F61)", () => {
  const rows = [
    row({ level: "account", objectId: "act_1", date: "2026-10-01", spend: 40000, clicks: 1200, impressions: 60000, leads: 30 }),
    row({ level: "campaign", objectId: "c1", objectName: "Leads octubre", date: "2026-10-01", spend: 30000, clicks: 900, leads: 25 }),
    row({ level: "campaign", objectId: "c2", objectName: "Remarketing", date: "2026-10-01", spend: 10000, clicks: 300, leads: 5 }),
  ];

  it("trae los totales de la cuenta con sus unidades", () => {
    const context = buildAnalysisContext({ periodLabel: "Ultimos 30 dias", currency: "ARS", rows });

    expect(context).toContain("TOTALES DE LA CUENTA");
    expect(context).toContain("Leads: 30");
    expect(context).toContain("Ultimos 30 dias");
  });

  it("las campañas van ordenadas por gasto", () => {
    // Son sobre las que hay algo que decidir.
    const context = buildAnalysisContext({ periodLabel: "p", currency: "ARS", rows });
    const first = context.indexOf("Leads octubre");
    const second = context.indexOf("Remarketing");

    expect(first).toBeLessThan(second);
  });

  it("con muchas campañas manda solo las de mas gasto, y dice cuantas hay", () => {
    // Una cuenta con cien llenaria el contexto de filas irrelevantes.
    const many = [
      rows[0],
      ...Array.from({ length: 30 }, (_, i) =>
        row({
          level: "campaign",
          objectId: `c${i}`,
          objectName: `Campaña ${i}`,
          date: "2026-10-01",
          spend: i * 100,
        }),
      ),
    ];

    const context = buildAnalysisContext({ periodLabel: "p", currency: "ARS", rows: many });
    const mentioned = (context.match(/^- Campaña /gm) ?? []).length;

    expect(mentioned).toBe(MAX_CAMPAIGNS);
    expect(context).toContain("de 30");
  });

  it("sin datos lo dice en vez de mandar un contexto vacio", () => {
    const context = buildAnalysisContext({ periodLabel: "p", currency: null, rows: [] });

    expect(context).toContain("No hay campañas ni anuncios");
  });

  it("un dato que falta se dice, no se inventa un cero", () => {
    const context = buildAnalysisContext({
      periodLabel: "p",
      currency: "ARS",
      rows: [row({ level: "account", objectId: "act_1", date: "2026-10-01", spend: 100 })],
    });

    expect(context).toContain("Alcance: sin dato");
  });
});

describe("si hay algo que analizar (F61)", () => {
  it("sin gasto, no", () => {
    expect(hasSomethingToAnalyze([row({ level: "account", objectId: "a", date: "d", spend: 0 })])).toBe(
      false,
    );
    expect(hasSomethingToAnalyze([])).toBe(false);
  });

  it("con gasto, si", () => {
    expect(hasSomethingToAnalyze([row({ level: "account", objectId: "a", date: "d", spend: 5 })])).toBe(
      true,
    );
  });
});
