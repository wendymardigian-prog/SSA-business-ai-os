import { describe, it, expect } from "vitest";
import { calculateNPS, calculateAverage, summarizeSurvey, distribution, evolution, granularityFor } from "./survey-metrics";

describe("calculateNPS", () => {
  it("[10,9,8,7,6,0] da 0 (2 promotores y 2 detractores de 6)", () => {
    expect(calculateNPS([10, 9, 8, 7, 6, 0])).toBe(0);
  });
  it("sin respuestas da null", () => {
    expect(calculateNPS([])).toBeNull();
  });
  it("todos promotores = 100, todos detractores = -100", () => {
    expect(calculateNPS([10, 9, 9])).toBe(100);
    expect(calculateNPS([0, 3, 6])).toBe(-100);
  });
  it("los pasivos no cuentan pero sí están en el total", () => {
    expect(calculateNPS([10, 8, 8, 8])).toBe(25);
  });
});

describe("calculateAverage", () => {
  it("[5,4,4] da 4.33", () => {
    expect(calculateAverage([5, 4, 4])).toBe(4.33);
  });
  it("sin respuestas da null (no 0)", () => {
    expect(calculateAverage([])).toBeNull();
  });
});

describe("summarizeSurvey", () => {
  it("NPS: porcentajes enteros y promedio", () => {
    expect(summarizeSurvey([10, 9, 8, 3], "nps")).toEqual({ responses: 4, nps: 25, average: 7.5, promotersPct: 50, passivesPct: 25, detractorsPct: 25 });
  });
  it("estrellas: solo promedio", () => {
    expect(summarizeSurvey([5, 4, 4], "stars")).toEqual({ responses: 3, nps: null, average: 4.33, promotersPct: null, passivesPct: null, detractorsPct: null });
  });
  it("sin respuestas: todo null", () => {
    expect(summarizeSurvey([], "nps")).toEqual({ responses: 0, nps: null, average: null, promotersPct: null, passivesPct: null, detractorsPct: null });
  });
});

describe("distribution", () => {
  it("NPS: 11 barras con la categoría por color y ceros donde no hay", () => {
    const bars = distribution([10, 10, 9, 0], "nps");
    expect(bars).toHaveLength(11);
    expect(bars[10]).toEqual({ value: 10, count: 2, category: "promoter" });
    expect(bars[7]).toEqual({ value: 7, count: 0, category: "passive" });
    expect(bars[0]).toEqual({ value: 0, count: 1, category: "detractor" });
  });
  it("estrellas: 5 barras sin categoría; ignora lo que cae fuera de la escala", () => {
    const bars = distribution([5, 5, 1, 9], "stars");
    expect(bars.map((b) => b.value)).toEqual([1, 2, 3, 4, 5]);
    expect(bars[4].count).toBe(2);
    expect(bars.every((b) => b.category === null)).toBe(true);
    expect(bars.reduce((n, b) => n + b.count, 0)).toBe(3);
  });
});

describe("evolution", () => {
  it("una respuesta a las 23:30 de Costa Rica cuenta en el día local", () => {
    // 23:30 del 10/10 en Costa Rica = 05:30 UTC del 11/10. Ambos caen en la semana del lunes 5/10.
    const points = evolution([{ created_at: "2026-10-11T05:30:00Z", score: 10 }], "week", "America/Costa_Rica", "nps");
    expect(points).toEqual([{ key: "2026-10-05", count: 1, value: 100, few: true }]);
  });
  it("y la frontera de una semana respeta la zona", () => {
    // Domingo 11/10 23:30 CR = lunes 12/10 05:30 UTC: en CR sigue siendo la semana del 5/10, no la del 12/10.
    const cr = evolution([{ created_at: "2026-10-12T05:30:00Z", score: 9 }], "week", "America/Costa_Rica", "nps");
    const utc = evolution([{ created_at: "2026-10-12T05:30:00Z", score: 9 }], "week", "UTC", "nps");
    expect(cr[0].key).toBe("2026-10-05");
    expect(utc[0].key).toBe("2026-10-12");
  });
  it("agrupa por mes y marca 'pocas respuestas' con menos de 5", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ created_at: `2026-09-1${i}T12:00:00Z`, score: 9 }));
    rows.push({ created_at: "2026-10-02T12:00:00Z", score: 2 });
    const points = evolution(rows, "month", "UTC", "nps");
    expect(points).toEqual([
      { key: "2026-09", count: 5, value: 100, few: false },
      { key: "2026-10", count: 1, value: -100, few: true },
    ]);
  });
  it("estrellas: el valor es el promedio", () => {
    expect(evolution([{ created_at: "2026-10-05T12:00:00Z", score: 4 }, { created_at: "2026-10-06T12:00:00Z", score: 5 }], "week", "UTC", "stars")[0].value).toBe(4.5);
  });
  it("sin filas no hay puntos, y la granularidad pasa a mes después de 90 días", () => {
    expect(evolution([], "week", "UTC", "nps")).toEqual([]);
    expect(granularityFor(30)).toBe("week");
    expect(granularityFor(90)).toBe("week");
    expect(granularityFor(180)).toBe("month");
  });
});
