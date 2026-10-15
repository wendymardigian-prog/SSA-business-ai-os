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
    metrics: [{ objectId: "a1", leadsNew: 1, leadsTotal: 5, leadsWithBooking: 2, bookings: 2, bookingsAttended: 1, sales: 0, revenueCents: 0, cashCents: 0, ufCashCents: 0 }],
    catalog: { a1: { name: "Video, testimonio", effectiveStatus: "ACTIVE" } },
  });

  it("lleva las columnas visibles en orden, una fila por objeto y el total", () => {
    const csv = toCsv({ firstColumnLabel: "Anuncio", columns: [col("spend"), col("leadsTotal"), col("cplTotal"), col("roas")], rows, total: totalRow(rows) });
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("Anuncio,Gasto,Leads totales,CPL total,ROAS");
    expect(lines[1]).toBe('"Video, testimonio",100,5,20,0');
    expect(lines[2]).toBe("Total,100,5,20,0");
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("exporta EN EL ORDEN ELEGIDO, no el del catalogo", () => {
    const csv = toCsv({ firstColumnLabel: "Anuncio", columns: [col("roas"), col("spend")], rows, total: totalRow(rows) });
    expect(csv.replace("﻿", "").split("\r\n")[0]).toBe("Anuncio,ROAS,Gasto");
  });

  it("«Estado» ya no es una columna fija: sale solo si esta entre las visibles", () => {
    const sin = toCsv({ firstColumnLabel: "Anuncio", columns: [col("spend")], rows, total: totalRow(rows) });
    expect(sin.replace("﻿", "").split("\r\n")[0]).toBe("Anuncio,Gasto");
    const con = toCsv({ firstColumnLabel: "Anuncio", columns: [col("status"), col("spend")], rows, total: totalRow(rows) });
    const lines = con.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("Anuncio,Estado,Gasto");
    expect(lines[1]).toBe('"Video, testimonio",Activo,100');
    // El total no tiene estado.
    expect(lines[2]).toBe("Total,Sin estado,100");
  });

  it("lo que no se puede calcular va vacio (no 0)", () => {
    const csv = toCsv({ firstColumnLabel: "Anuncio", columns: [col("costPerNewDeal"), col("costPerBooking")], rows, total: totalRow(rows) });
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    // 0 ventas: costo por nuevo deal vacio; 2 agendas: costo por agenda 50.
    expect(lines[1]).toBe('"Video, testimonio",,50');
  });

  it("las columnas nuevas: video y conversiones salen vacias si Meta no las manda, y los textos como texto", () => {
    const csv = toCsv({ firstColumnLabel: "Anuncio", columns: [col("hookRate"), col("applications"), col("qualityRanking"), col("campaignName")], rows, total: totalRow(rows) });
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("Anuncio,Hook rate,Aplicaciones,Ranking de calidad,Campaña");
    expect(lines[1]).toBe('"Video, testimonio",,,,');
  });
});

describe("csvFilename", () => {
  it("lleva el nivel y el periodo", () => {
    expect(csvFilename("ad", "2026-09-14", "2026-10-13")).toBe("anuncios-meta-vs-crm-2026-09-14_2026-10-13.csv");
    expect(csvFilename("campaign", "", "")).toBe("campanas-meta-vs-crm-periodo.csv");
    expect(csvFilename("adset", "2026-01-01", "2026-01-31")).toContain("conjuntos");
  });
});
