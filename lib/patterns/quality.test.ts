import { describe, it, expect } from "vitest";
import { qualityReport, confidenceCalibration } from "./quality";

const t = (over: Partial<Parameters<typeof qualityReport>[0][number]> = {}) => ({
  category_id: "c1", source: "model" as const, confidence: 0.9, review_result: null, messageCount: 1, ...over,
});

describe("qualityReport (F25)", () => {
  it("precisión solo con revisados", () => {
    const r = qualityReport([
      t({ review_result: "ok" }), t({ review_result: "ok" }), t({ review_result: "corrected" }), t({ review_result: null }),
    ], new Set());
    expect(r.reviewedCount).toBe(3);
    expect(r.estimatedAccuracy).toBeCloseTo(0.67, 2);
  });
  it("sin revisados → precisión null", () => {
    expect(qualityReport([t()], new Set()).estimatedAccuracy).toBeNull();
  });
  it("corregidos = filas del modelo movidas", () => {
    expect(qualityReport([t({ review_result: "corrected" }), t({ source: "human", review_result: "corrected" })], new Set()).corrected).toBe(1);
  });
  it("sin categoría por VOLUMEN de mensajes", () => {
    const r = qualityReport([
      t({ category_id: "otro", messageCount: 30 }),
      t({ category_id: null, messageCount: 20 }),
      t({ category_id: "c1", messageCount: 50 }),
    ], new Set(["otro"]));
    expect(r.uncategorizedMessagePct).toBe(50); // (30+20)/100
  });
  it("dudosos = confianza < 0,70", () => {
    expect(qualityReport([t({ confidence: 0.6 }), t({ confidence: 0.95 }), t({ confidence: null })], new Set()).lowConfidence).toBe(1);
  });
});

describe("confidenceCalibration (F25)", () => {
  it("aciertos por tramo", () => {
    const c = confidenceCalibration([
      { confidence: 0.95, review_result: "ok" },
      { confidence: 0.95, review_result: "corrected" },
      { confidence: 0.8, review_result: "ok" },
      { confidence: 0.5, review_result: "corrected" },
    ]);
    expect(c.high).toEqual({ n: 2, accuracy: 0.5 });
    expect(c.mid).toEqual({ n: 1, accuracy: 1 });
    expect(c.low).toEqual({ n: 1, accuracy: 0 });
  });
});
