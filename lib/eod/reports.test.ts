import { describe, it, expect } from "vitest";
import { applyChannelFilter, buildReportsCsv, metricCell, metricColumns, parseReportFilters, pendingToday, periodTotals, reportStatusLabel, type EodReportListRow } from "./reports";

const row = (id: string, links: number, extra: Partial<EodReportListRow> = {}): EodReportListRow => ({
  id,
  userId: `u-${id}`,
  userName: `Persona ${id}`,
  reportDate: "2026-10-12",
  status: "submitted",
  submittedAt: "2026-10-12T23:00:00Z",
  editedAt: null,
  editCount: 0,
  metrics: { total: { links_enviados: links }, instagram: { links_enviados: links } },
  channelKeys: ["instagram"],
  ...extra,
});

describe("totales del período", () => {
  it("DADOS 3 reportes con 5, 7 y 10 links, el total es 22", () => {
    const totals = periodTotals([row("a", 5), row("b", 7), row("c", 10)]);
    expect(totals.total.links_enviados).toBe(22);
    expect(totals.byChannel.instagram.links_enviados).toBe(22);
    expect(totals.reports).toBe(3);
  });

  it("un borrador no suma", () => {
    expect(periodTotals([row("a", 5), row("b", 7, { status: "draft" })]).total.links_enviados).toBe(5);
  });

  it("con un canal elegido, el total es el de ese canal", () => {
    const r = row("a", 0, { metrics: { total: { links_enviados: 12 }, instagram: { links_enviados: 5 }, whatsapp: { links_enviados: 7 } }, channelKeys: ["instagram", "whatsapp"] });
    expect(periodTotals([r], "whatsapp").total.links_enviados).toBe(7);
    expect(metricCell(r, "links_enviados", "whatsapp")).toBe(7);
    expect(metricCell(r, "links_enviados", null)).toBe(12);
    expect(applyChannelFilter([r, row("b", 1)], "whatsapp").map((x) => x.id)).toEqual(["a"]);
  });
});

describe("columnas, estado y filtros", () => {
  it("una columna por métrica con su nombre", () => {
    expect(metricColumns(["links_enviados", "mi_metrica"])).toEqual([
      { key: "links_enviados", label: "Links enviados" },
      { key: "mi_metrica", label: "mi_metrica" },
    ]);
  });

  it("En curso / Enviado / Corregido", () => {
    expect(reportStatusLabel({ status: "draft", editCount: 0 })).toBe("En curso");
    expect(reportStatusLabel({ status: "submitted", editCount: 0 })).toBe("Enviado");
    expect(reportStatusLabel({ status: "submitted", editCount: 2 })).toBe("Corregido");
  });

  it("los filtros por defecto son los últimos 7 días, sin fechas futuras ni rangos gigantes", () => {
    expect(parseReportFilters({}, "2026-10-12")).toMatchObject({ from: "2026-10-06", to: "2026-10-12", person: null, channel: null, page: 1 });
    expect(parseReportFilters({ hasta: "2026-12-01" }, "2026-10-12").to).toBe("2026-10-12");
    expect(parseReportFilters({ desde: "2025-01-01", hasta: "2026-10-12" }, "2026-10-12").from).toBe("2026-07-13");
    expect(parseReportFilters({ canal: "Mal Canal", persona: "x" }, "2026-10-12")).toMatchObject({ channel: null, person: null });
  });
});

describe("pendientes de hoy", () => {
  it("quién falta, con el hoy de cada uno: primero los que están en curso", () => {
    const audience = [
      { userId: "ana", name: "Ana", today: "2026-10-12" },
      { userId: "beto", name: "Beto", today: "2026-10-13" },
      { userId: "caro", name: "Caro", today: "2026-10-12" },
    ];
    const status = (u: string, d: string) => (u === "ana" && d === "2026-10-12" ? "submitted" : u === "caro" ? "draft" : null);
    expect(pendingToday(audience, status)).toEqual([
      { userId: "caro", name: "Caro", state: "draft" },
      { userId: "beto", name: "Beto", state: "none" },
    ]);
  });
});

describe("CSV", () => {
  it("con BOM y sin fórmulas", () => {
    const csv = buildReportsCsv([row("a", 5, { userName: "=HYPERLINK(1)" })], metricColumns(["links_enviados"]), { channel: null, formatDate: (iso) => iso.slice(0, 10) });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("Links enviados");
  });
});
