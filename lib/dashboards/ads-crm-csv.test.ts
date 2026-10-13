import { describe, expect, it } from "vitest";
import { COLUMNS } from "./ads-crm-columns";
import { csvEscape, csvFilename, toCsv } from "./ads-crm-csv";
import { buildCrmRows, totalRow } from "./ads-crm";

const col = (id: string) => COLUMNS.find((c) => c.id === id)!;

describe("csvEscape", () => {
  it("entrecomilla lo que tiene coma, comillas o saltos", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvEscape("uno\ndos")).toBe('"uno\ndos"');
    expect(csvEscape("simple")).toBe("simple");
  });
  it("un valor que empieza como formula no se ejecuta en la planilla", () => {
    expect(csvEscape("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvEscape("+5")).toBe("'+5");
    expect(csvEscape("@cmd")).toBe("'@cmd");
  });
});

describe("toCsv", () => {
  const rows = buildCrmRows({
    rows: [
      { level: "ad", objectId: "a1", objectName: "Video, testimonio", parentName: null, campaignId: null, adsetId: null, date: "2026-10-01", spend: 100, impressions: 1000, reach: 500, clicks: 20, outboundClicks: null, linkClicks: null, leads: 4, purchases: null, purchaseValue: null, status: null, effectiveStatus: null, qualityRanking: null, engagementRanking: null, conversionRanking: null, videoP25: null, videoP50: null, videoP75: null, videoP95: null, videoP100: null, thruplays: null, videoAvgTimeSeconds: null, actions: {}, updatedAt: null },
    ],
    level: "ad",
    metrics: [{ objectId: "a1", leadsFirst: 1, leadsTotal: 5, leadsWithBooking: 2, bookings: 2, bookingsAttended: 1, sales: 0, revenueCents: 0, cashCents: 0 }],
    catalog: { a1: { name: "Video, testimonio", effectiveStatus: "ACTIVE" } },
  });

  it("lleva las columnas visibles en orden, una fila por objeto y el total", () => {
    const csv = toCsv({ firstColumnLabel: "Anuncio", columns: [col("spend"), col("leadsCrm"), col("cplReal"), col("roas")], rows, total: totalRow(rows) });
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("Anuncio,Estado,Gasto,Leads CRM,CPL real,ROAS");
    expect(lines[1]).toBe('"Video, testimonio",ACTIVE,100,5,20,0');
    expect(lines[2]).toBe("Total,,100,5,20,0");
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("lo que no se puede calcular va vacio (no 0)", () => {
    const csv = toCsv({ firstColumnLabel: "Anuncio", columns: [col("cac"), col("costPerBooking")], rows, total: totalRow(rows) });
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    // 0 ventas: CAC vacio; 2 agendas: costo por agenda 50.
    expect(lines[1]).toBe('"Video, testimonio",ACTIVE,,50');
  });
});

describe("csvFilename", () => {
  it("lleva el nivel y el periodo", () => {
    expect(csvFilename("ad", "2026-09-14", "2026-10-13")).toBe("anuncios-meta-vs-crm-2026-09-14_2026-10-13.csv");
    expect(csvFilename("campaign", "", "")).toBe("campanas-meta-vs-crm-periodo.csv");
    expect(csvFilename("adset", "2026-01-01", "2026-01-31")).toContain("conjuntos");
  });
});
