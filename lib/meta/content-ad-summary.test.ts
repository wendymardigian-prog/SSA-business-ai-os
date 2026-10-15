import { describe, expect, it } from "vitest";
import {
  NOTE_CURRENCIES,
  NOTE_DISTINCT,
  NOTE_NO_CRM,
  adDetailHref,
  costPer,
  hasMixedCurrencies,
  linkMenuLabels,
  showAdsSection,
  showPaidIndicator,
  sumColumn,
  summarizePieceAds,
  summaryTiles,
  type CrmRow,
  type InsightRow,
  type LinkedAd,
} from "./content-ad-summary";

const ad = (adId: string, over: Partial<LinkedAd> = {}): LinkedAd => ({ adId, name: `Anuncio ${adId}`, status: "ACTIVE", adAccountId: "act_1", href: adDetailHref(adId, "act_1"), manual: false, ...over });
const row = (object_id: string | null, over: Partial<CrmRow> = {}): CrmRow => ({ object_id, is_total: false, leads_first: 0, leads_total: 0, bookings: 0, sales: 0, ...over });
const total = (leads_total: number): CrmRow => row(null, { is_total: true, leads_first: null, leads_total, bookings: null, sales: null });

describe("sumColumn y costPer", () => {
  it("suma lo que hay y devuelve null si no hay nada (no un cero)", () => {
    expect(sumColumn([1, 2, null, undefined])).toBe(3);
    expect(sumColumn([null, undefined])).toBeNull();
    expect(sumColumn([])).toBeNull();
    expect(sumColumn([0, null])).toBe(0);
  });
  it("el costo por algo que no pasó no existe", () => {
    expect(costPer(100, 4)).toBe(25);
    expect(costPer(100, 0)).toBeNull();
    expect(costPer(null, 4)).toBeNull();
    expect(costPer(100, null)).toBeNull();
  });
});

describe("summarizePieceAds · con 0, 1 o varios anuncios", () => {
  it("sin anuncios no hay sección: state none y nada que mostrar", () => {
    const s = summarizePieceAds({ ads: [], insights: [{ spend: 10, impressions: 1, clicks: 1 }], crm: [row("x", { leads_first: 3 })] });
    expect(s.state).toBe("none");
    expect(s.ads).toEqual([]);
    expect(s.spend).toBeNull();
    expect(s.leadsNew).toBeNull();
    expect(s.notes).toEqual([]);
  });

  it("con un anuncio: sus números, sin el aviso de personas distintas", () => {
    const insights: InsightRow[] = [{ spend: 60, impressions: 1000, clicks: 40 }, { spend: 40, impressions: 500, clicks: 10 }];
    const s = summarizePieceAds({ ads: [ad("a")], insights, crm: [row("a", { leads_first: 4, leads_total: 5, bookings: 2, sales: 1 }), total(5)] });
    expect(s.state).toBe("single");
    expect(s).toMatchObject({ spend: 100, impressions: 1500, clicks: 50, leadsNew: 4, leadsTotal: 5, bookings: 2, sales: 1, cplNew: 25, cplTotal: 20 });
    expect(s.notes).toEqual([]);
  });

  it("con varios: los leads totales son PERSONAS distintas (la fila de total), no la suma", () => {
    const s = summarizePieceAds({
      ads: [ad("a"), ad("b")],
      insights: [{ spend: 100, impressions: 10, clicks: 1 }],
      // Una persona tocó los dos anuncios: la suma de las filas da 2 y las personas son 1.
      crm: [row("a", { leads_first: 1, leads_total: 1, bookings: 1 }), row("b", { leads_first: 0, leads_total: 1, bookings: 0, sales: 1 }), total(1)],
    });
    expect(s.state).toBe("multiple");
    expect(s.leadsNew).toBe(1);
    expect(s.leadsTotal).toBe(1);
    expect(s.cplTotal).toBe(100);
    expect(s.cplNew).toBe(100);
    expect(s.bookings).toBe(1);
    expect(s.sales).toBe(1);
    expect(s.notes).toContain(NOTE_DISTINCT);
  });

  it("sin leads el costo por lead es null, no cero ni infinito", () => {
    const s = summarizePieceAds({ ads: [ad("a")], insights: [{ spend: 50, impressions: 1, clicks: 1 }], crm: [row("a"), total(0)] });
    expect(s.leadsNew).toBe(0);
    expect(s.leadsTotal).toBe(0);
    expect(s.cplNew).toBeNull();
    expect(s.cplTotal).toBeNull();
  });

  it("sin gasto registrado (insights vacíos) el gasto es null y también sus costos", () => {
    const s = summarizePieceAds({ ads: [ad("a")], insights: [], crm: [row("a", { leads_first: 2, leads_total: 2 }), total(2)] });
    expect(s.spend).toBeNull();
    expect(s.impressions).toBeNull();
    expect(s.cplNew).toBeNull();
    expect(s.leadsNew).toBe(2);
  });

  it("si no se pudo leer el CRM, se muestra lo de Meta y se avisa (sin inventar ceros)", () => {
    const s = summarizePieceAds({ ads: [ad("a")], insights: [{ spend: 10, impressions: 100, clicks: 5 }], crm: null });
    expect(s.spend).toBe(10);
    expect(s.leadsNew).toBeNull();
    expect(s.leadsTotal).toBeNull();
    expect(s.bookings).toBeNull();
    expect(s.cplNew).toBeNull();
    expect(s.notes).toEqual([NOTE_NO_CRM]);
  });

  it("sin la fila de total (por ejemplo una versión vieja), los leads totales caen a la suma", () => {
    const s = summarizePieceAds({ ads: [ad("a"), ad("b")], insights: [], crm: [row("a", { leads_total: 2 }), row("b", { leads_total: 3 })] });
    expect(s.leadsTotal).toBe(5);
  });

  it("monedas distintas: no se suma el gasto ni se calcula el costo, y se avisa", () => {
    const s = summarizePieceAds({
      ads: [ad("a"), ad("b", { adAccountId: "act_2" })],
      insights: [{ spend: 10, impressions: 1, clicks: 1 }, { spend: 20, impressions: 1, clicks: 1 }],
      crm: [row("a", { leads_first: 1, leads_total: 1 }), total(1)],
      currencyMixed: true,
    });
    expect(s.spend).toBeNull();
    expect(s.cplNew).toBeNull();
    expect(s.cplTotal).toBeNull();
    expect(s.impressions).toBe(2);
    expect(s.notes).toContain(NOTE_CURRENCIES);
  });
});

describe("ayudas", () => {
  it("monedas: solo cuentan las conocidas y distintas", () => {
    expect(hasMixedCurrencies(["USD", "usd", null])).toBe(false);
    expect(hasMixedCurrencies(["USD", "EUR"])).toBe(true);
    expect(hasMixedCurrencies([])).toBe(false);
    expect(hasMixedCurrencies([null, undefined, ""])).toBe(false);
  });
  it("el enlace al detalle codifica el id y la cuenta", () => {
    expect(adDetailHref("120 01", "act_9")).toBe("/dashboard/dashboards/ads/ads/120%2001?cuenta=act_9");
  });
  it("el menú ofrece desvincular solo si hay algo vinculado", () => {
    expect(linkMenuLabels(0)).toEqual({ link: "Vincular a un anuncio", unlink: null });
    expect(linkMenuLabels(1).unlink).toBe("Desvincular el anuncio");
    expect(linkMenuLabels(3).unlink).toBe("Desvincular un anuncio");
  });
});

describe("summaryTiles", () => {
  const format = { money: (v: number | null) => (v === null ? "—" : `$${v}`), count: (v: number | null) => (v === null ? "—" : String(v)) };

  it("el orden es el de lectura y lo que no existe es un guion, no un cero", () => {
    const tiles = summaryTiles(summarizePieceAds({ ads: [ad("a")], insights: [], crm: null }), format);
    expect(tiles.map((t) => t.key)).toEqual(["spend", "impressions", "clicks", "leadsNew", "leadsTotal", "cplNew", "cplTotal", "bookings", "sales"]);
    expect(tiles.every((t) => t.value === "—")).toBe(true);
  });

  it("muestra los dos CPL y lo que explica cada uno", () => {
    const s = summarizePieceAds({ ads: [ad("a")], insights: [{ spend: 100, impressions: 10, clicks: 2 }], crm: [row("a", { leads_first: 2, leads_total: 4, bookings: 1, sales: 0 }), total(4)] });
    const byKey = Object.fromEntries(summaryTiles(s, format).map((t) => [t.key, t]));
    expect(byKey.cplNew.value).toBe("$50");
    expect(byKey.cplTotal.value).toBe("$25");
    expect(byKey.sales.value).toBe("0"); // una venta en cero SÍ es un dato: el CRM respondió
    expect(byKey.leadsNew.tip).toMatch(/primer toque/);
    expect(byKey.leadsTotal.tip).toMatch(/algún toque/);
  });
});

describe("qué aparece con 0, 1 o varios anuncios", () => {
  it("la sección «Publicidad» solo existe con al menos un anuncio vinculado", () => {
    expect(showAdsSection([])).toBe(false);
    expect(showAdsSection([ad("a")])).toBe(true);
    expect(showAdsSection([ad("a"), ad("b")])).toBe(true);
  });
  it("«Pautada» solo para quien puede ver anuncios y solo si la pieza tiene uno", () => {
    expect(showPaidIndicator(true, true)).toBe(true);
    expect(showPaidIndicator(true, false)).toBe(false);
    expect(showPaidIndicator(true, undefined)).toBe(false);
    expect(showPaidIndicator(false, true)).toBe(false);
  });
});
