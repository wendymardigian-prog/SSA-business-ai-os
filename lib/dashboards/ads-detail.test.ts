/**
 * Los detalles de campaña, conjunto y anuncio (F57).
 */

import { describe, it, expect } from "vitest";
import type { AdsRow } from "./ads";
import {
  breadcrumbs,
  buildDetail,
  budgetProgress,
  ownRows,
  rankingLabel,
  rowsFor,
  siblingAds,
} from "./ads-detail";

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
  videoAvgTimeSeconds: null,
  actions: {},
  updatedAt: null,
  ...over,
});

/** Dos campañas, cada una con un conjunto y un anuncio. */
const rows: AdsRow[] = [
  row({ level: "campaign", objectId: "c1", objectName: "Campaña 1", campaignId: "c1", date: "2026-10-01", spend: 100 }),
  row({ level: "adset", objectId: "as1", objectName: "Conjunto 1", campaignId: "c1", date: "2026-10-01", spend: 60 }),
  row({ level: "ad", objectId: "a1", objectName: "Anuncio 1", campaignId: "c1", adsetId: "as1", date: "2026-10-01", spend: 60 }),
  row({ level: "ad", objectId: "a2", objectName: "Anuncio 2", campaignId: "c1", adsetId: "as1", date: "2026-10-01", spend: 40 }),
  row({ level: "campaign", objectId: "c2", objectName: "Campaña 2", campaignId: "c2", date: "2026-10-01", spend: 500 }),
  row({ level: "adset", objectId: "as2", campaignId: "c2", date: "2026-10-01", spend: 500 }),
  row({ level: "ad", objectId: "a9", objectName: "Anuncio de otra", campaignId: "c2", adsetId: "as2", date: "2026-10-01", spend: 500 }),
];

describe("que filas son de cada objeto (F57)", () => {
  it("una campaña trae la suya, sus conjuntos y sus anuncios", () => {
    const scoped = rowsFor(rows, { level: "campaign", objectId: "c1" });

    expect(scoped.map((r) => r.objectId).sort()).toEqual(["a1", "a2", "as1", "c1"]);
  });

  it("y NUNCA los de otra campaña", () => {
    // Las conclusiones que sacan de una pantalla asi son falsas.
    const scoped = rowsFor(rows, { level: "campaign", objectId: "c1" });

    expect(scoped.some((r) => r.objectId === "a9")).toBe(false);
  });

  it("un conjunto trae el suyo y sus anuncios", () => {
    expect(rowsFor(rows, { level: "adset", objectId: "as1" }).map((r) => r.objectId).sort()).toEqual([
      "a1",
      "a2",
      "as1",
    ]);
  });

  it("un anuncio, solo el", () => {
    expect(rowsFor(rows, { level: "ad", objectId: "a1" }).map((r) => r.objectId)).toEqual(["a1"]);
  });

  it("las filas propias son solo las de su nivel", () => {
    expect(ownRows(rows, { level: "campaign", objectId: "c1" })).toHaveLength(1);
  });
});

describe("armar el detalle (F57)", () => {
  it("los totales salen de las filas propias, no de la suma de los hijos", () => {
    // Sumar campaña + conjuntos + anuncios contaria el gasto tres veces.
    const detail = buildDetail({ rows, level: "campaign", objectId: "c1" });

    expect(detail?.totals.spend).toBe(100);
  });

  it("los hijos de una campaña son sus conjuntos", () => {
    const detail = buildDetail({ rows, level: "campaign", objectId: "c1" });

    expect(detail?.children.map((c) => c.objectId)).toEqual(["as1"]);
  });

  it("la pestaña de anuncios trae solo los de esa campaña", () => {
    const detail = buildDetail({ rows, level: "campaign", objectId: "c1" });

    expect(detail?.ads.map((a) => a.objectId).sort()).toEqual(["a1", "a2"]);
  });

  it("un objeto sin actividad en el periodo no tiene detalle", () => {
    expect(buildDetail({ rows, level: "campaign", objectId: "no-existe" })).toBeNull();
  });

  it("un anuncio no tiene hijos", () => {
    expect(buildDetail({ rows, level: "ad", objectId: "a1" })?.children).toEqual([]);
  });
});

describe("las migas de pan (F57)", () => {
  it("llevan la cuenta y el periodo en cada link", () => {
    // Volver atras con otra cuenta mostraria numeros de otra cuenta.
    const crumbs = breadcrumbs({
      level: "ad",
      campaign: { id: "c1", name: "Campaña 1" },
      adset: { id: "as1", name: "Conjunto 1" },
      ad: { name: "Anuncio 1" },
      adAccountId: "act_9",
      period: "30d",
    });

    expect(crumbs[0].href).toContain("cuenta=act_9");
    expect(crumbs[0].href).toContain("periodo=30d");
  });

  it("el ultimo no es un link: ya estas ahi", () => {
    const crumbs = breadcrumbs({
      level: "campaign",
      campaign: { id: "c1", name: "Campaña 1" },
      adAccountId: "act_9",
      period: "30d",
    });

    expect(crumbs.at(-1)?.href).toBeNull();
  });
});

describe("la barra de presupuesto (F57)", () => {
  it("un presupuesto total compara lo gastado contra el tope", () => {
    expect(
      budgetProgress({ dailyBudget: null, lifetimeBudget: 1000, spent: 250, days: 10 }),
    ).toMatchObject({ kind: "lifetime", remaining: 750, percent: 25 });
  });

  it("un presupuesto diario no tiene restante: se renueva cada dia", () => {
    const budget = budgetProgress({ dailyBudget: 50, lifetimeBudget: null, spent: 400, days: 10 });

    expect(budget).toMatchObject({ kind: "daily", spent: 40, remaining: null, percent: 80 });
  });

  it("sin presupuesto configurado, no hay barra", () => {
    expect(budgetProgress({ dailyBudget: null, lifetimeBudget: null, spent: 100, days: 5 })).toBeNull();
  });
});

describe("los otros anuncios de la campaña (F57)", () => {
  it("son los de la misma campaña, sin el actual", () => {
    expect(siblingAds(rows, { campaignId: "c1", currentAdId: "a1" }).map((a) => a.id)).toEqual(["a2"]);
  });

  it("sin campaña no hay hermanos", () => {
    expect(siblingAds(rows, { campaignId: null, currentAdId: "a1" })).toEqual([]);
  });
});

describe("los rankings (F57)", () => {
  it("se muestran en castellano", () => {
    expect(rankingLabel("ABOVE_AVERAGE")).toBe("Arriba del promedio");
    expect(rankingLabel("BELOW_AVERAGE_10")).toContain("10% inferior");
  });

  it("sin ranking se dice que faltan datos, no se deja vacio", () => {
    expect(rankingLabel(null)).toBe("Sin datos suficientes");
  });
});
