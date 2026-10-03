import { describe, it, expect } from "vitest";
import { buildAiKpiCards, comparePeriod, type PeriodTotals } from "./kpis";

function totals(partial: Partial<PeriodTotals>): PeriodTotals {
  return { runs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, embeddingTokens: 0, missingPricing: 0, ...partial };
}

describe("comparePeriod", () => {
  it("sin anterior, dice sin comparación y no un porcentaje infinito", () => {
    expect(comparePeriod(10, null)).toMatchObject({ percent: null, direction: null, label: "sin comparación" });
  });

  it("anterior en cero, igual: dividir por cero no es crecer infinito", () => {
    expect(comparePeriod(10, 0)).toMatchObject({ percent: null, label: "sin comparación" });
  });

  it("entre -1% y +1% dice sin cambios y no hay flecha", () => {
    expect(comparePeriod(100.5, 100)).toMatchObject({ direction: "flat", label: "sin cambios" });
    expect(comparePeriod(99.5, 100)).toMatchObject({ direction: "flat", label: "sin cambios" });
    expect(comparePeriod(100, 100)).toMatchObject({ direction: "flat", label: "sin cambios" });
  });

  it("por encima de 1% sube, con flecha arriba", () => {
    expect(comparePeriod(112, 100)).toMatchObject({ percent: 12, direction: "up", label: "▲ 12 %" });
  });

  it("por debajo de -1% baja, con flecha abajo", () => {
    expect(comparePeriod(88, 100)).toMatchObject({ percent: -12, direction: "down", label: "▼ 12 %" });
  });
});

describe("buildAiKpiCards", () => {
  it("las cuatro tarjetas con numero salen de los totales correctos", () => {
    const cards = buildAiKpiCards({
      totals: totals({ runs: 50, costUsd: 2.5, inputTokens: 1000, outputTokens: 500, cachedTokens: 100, embeddingTokens: 50, missingPricing: 3 }),
      previousTotals: totals({ runs: 40, costUsd: 2, inputTokens: 900, outputTokens: 400, cachedTokens: 80, embeddingTokens: 20 }),
      todayCost: 0.3,
      yesterdayCost: 0.2,
    });
    expect(cards.period.value).toBe(2.5);
    expect(cards.tokens.value).toBe(1650);
    expect(cards.runs.value).toBe(50);
    expect(cards.today.value).toBe(0.3);
    expect(cards.missingPricing).toBe(3);
  });

  it("hoy compara contra ayer, NO contra el periodo anterior entero", () => {
    const cards = buildAiKpiCards({
      totals: totals({ costUsd: 100 }),
      previousTotals: totals({ costUsd: 1000 }), // si comparara contra esto, daria una baja enorme
      todayCost: 1.1,
      yesterdayCost: 1,
    });
    expect(cards.today.comparison).toMatchObject({ percent: 10, direction: "up" });
  });

  it("en historico no hay periodo anterior: las cuatro comparaciones dicen sin comparación", () => {
    const cards = buildAiKpiCards({
      totals: totals({ runs: 10, costUsd: 1 }),
      previousTotals: null,
      todayCost: null,
      yesterdayCost: null,
    });
    expect(cards.period.comparison.label).toBe("sin comparación");
    expect(cards.tokens.comparison.label).toBe("sin comparación");
    expect(cards.runs.comparison.label).toBe("sin comparación");
    expect(cards.today.comparison.label).toBe("sin comparación");
  });

  it("si hoy no cae dentro del periodo elegido, el valor es null (no cero: no se sabe)", () => {
    const cards = buildAiKpiCards({ totals: totals({}), previousTotals: null, todayCost: null, yesterdayCost: null });
    expect(cards.today.value).toBeNull();
  });
});
