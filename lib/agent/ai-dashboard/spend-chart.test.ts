import { describe, it, expect } from "vitest";
import { buildSpendSeries, type SpendByDayRow } from "./spend-chart";
import { OTROS_KEY } from "./source-palette";

function row(partial: Partial<SpendByDayRow> & { day: string }): SpendByDayRow {
  return { source: null, runs: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, missing_pricing: 0, ...partial };
}

describe("buildSpendSeries", () => {
  it("un periodo sin ninguna corrida (source: null en todos los dias) no arma series", () => {
    const { series, points } = buildSpendSeries([row({ day: "2026-09-01" }), row({ day: "2026-09-02" })]);
    expect(series).toEqual([]);
    expect(points).toHaveLength(2);
  });

  it("solo aparecen los origenes con al menos una corrida en el rango (R5.3)", () => {
    const { series } = buildSpendSeries([
      row({ day: "2026-09-28", source: "agent", runs: 2, cost_usd: 0.5 }),
      row({ day: "2026-09-28", source: "ads_analysis", runs: 0, cost_usd: 0 }),
    ]);
    expect(series.map((s) => s.key)).toEqual(["agent"]);
  });

  it("un dia sin corridas de un origen que si aparece otro dia queda en cero, no se saltea", () => {
    const { series, points } = buildSpendSeries([
      row({ day: "2026-09-28", source: "agent", runs: 3, cost_usd: 1 }),
      row({ day: "2026-09-29", source: "agent", runs: 0, cost_usd: 0 }),
    ]);
    expect(points).toHaveLength(2);
    expect(series[0].points).toEqual([
      { bucket: "28 sept", value: 1 },
      { bucket: "29 sept", value: 0 },
    ]);
  });

  it("dos origenes de sistema el mismo dia se suman en Otros", () => {
    const { series } = buildSpendSeries([
      row({ day: "2026-09-28", source: "kb_indexing", runs: 1, cost_usd: 0.1 }),
      row({ day: "2026-09-28", source: "conversation_summary", runs: 1, cost_usd: 0.2 }),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0].key).toBe(OTROS_KEY);
    expect(series[0].points[0].value).toBeCloseTo(0.3);
  });

  it("el orden de las series es el fijo (SOURCE_ORDER), no el de llegada de las filas", () => {
    const { series } = buildSpendSeries([
      row({ day: "2026-09-28", source: "media_description", runs: 1, cost_usd: 1 }),
      row({ day: "2026-09-28", source: "agent", runs: 1, cost_usd: 1 }),
    ]);
    expect(series.map((s) => s.key)).toEqual(["agent", "media_description"]);
  });

  it("totalsByDay suma todos los origenes de ese dia, Otros incluido", () => {
    const { totalsByDay } = buildSpendSeries([
      row({ day: "2026-09-28", source: "agent", runs: 1, cost_usd: 1 }),
      row({ day: "2026-09-28", source: "kb_indexing", runs: 1, cost_usd: 0.5 }),
    ]);
    expect(totalsByDay.get("2026-09-28")).toBeCloseTo(1.5);
  });

  it("message_classification_eval, si alguna vez apareciera, caeria en Otros y no en una novena serie", () => {
    const { series } = buildSpendSeries([row({ day: "2026-09-28", source: "message_classification_eval", runs: 1, cost_usd: 1 })]);
    expect(series.map((s) => s.key)).toEqual([OTROS_KEY]);
  });
});
