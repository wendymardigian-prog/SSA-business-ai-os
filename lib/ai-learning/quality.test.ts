import { describe, expect, it } from "vitest";
import { formatRate, qualityTotals, qualityWeeks } from "./quality";

describe("panel de calidad", () => {
  const raw = [
    { week_start: "2026-11-09", decided: 10, approved: 6, approved_edited: 2, rejected: 2, reasons: { too_long: 1, tone: 1 } },
    { week_start: "2026-11-02", decided: 4, approved: 1, approved_edited: 1, rejected: 2, reasons: { too_long: 2 } },
  ];

  it("tasas de aprobación y edición por semana, en orden", () => {
    const weeks = qualityWeeks(raw);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-11-02", "2026-11-09"]);
    expect(weeks[1]).toMatchObject({ approvalRate: 60, editRate: 20, rejectionRate: 20 });
    // Empate: el orden de la lista cerrada.
    expect(weeks[1].reasons.map((r) => r.label)).toEqual(["Tono", "Demasiado largo"]);
  });

  it("el total se calcula sobre todas las decisiones, no promediando semanas", () => {
    const totals = qualityTotals(qualityWeeks(raw));
    expect(totals).toMatchObject({ decided: 14, approved: 7, approvalRate: 50, editRate: 21.4 });
    expect(totals.reasons[0]).toMatchObject({ reason: "too_long", count: 3 });
  });

  it("sin decisiones: «Sin dato», nunca 0 %", () => {
    const [week] = qualityWeeks([{ week_start: "2026-11-09", decided: 0, approved: 0, approved_edited: 0, rejected: 0, reasons: {} }]);
    expect(week.approvalRate).toBeNull();
    expect(formatRate(week.approvalRate)).toBe("Sin dato");
    expect(qualityTotals([]).approvalRate).toBeNull();
    expect(qualityWeeks(null)).toEqual([]);
  });
});
