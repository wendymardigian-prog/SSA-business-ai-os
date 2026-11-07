import { describe, expect, it } from "vitest";
import { badgeText, buildNodeMetrics, clickKeyLabel, exitLabel, isMetricPeriod, percent, periodRange } from "./node-metrics";

describe("buildNodeMetrics", () => {
  it("arma una ficha por paso con lo que devuelve la base", () => {
    const metrics = buildNodeMetrics([
      { node_id: "step-1", metric: "passed", key: null, value: 3 },
      { node_id: "step-1", metric: "status", key: "ok", value: 2 },
      { node_id: "step-1", metric: "status", key: "failed", value: 1 },
      { node_id: "step-1", metric: "failed_kind", key: "already_replied", value: 1 },
      { node_id: "step-1", metric: "failed_reason", key: "Otra app contestó primero.", value: 1 },
      { node_id: "step-1", metric: "sent", key: null, value: 2 },
      { node_id: "step-1", metric: "replied", key: null, value: 1 },
      { node_id: "step-1", metric: "clicks", key: "b0", value: 5 },
      { node_id: "step-1", metric: "clickers", key: "b0", value: 2 },
      { node_id: "step-1", metric: "clicks", key: "t", value: 1 },
      { node_id: "step-1", metric: "clickers", key: "t", value: 1 },
      { node_id: "step-1", metric: "clickers_any", key: null, value: 2 },
      { node_id: "cond", metric: "exit", key: "true", value: 4 },
      { node_id: "cond", metric: "algo_nuevo", key: null, value: 9 },
    ]);
    expect(metrics["step-1"]).toMatchObject({ passed: 3, ok: 2, failed: 1, sent: 2, replied: 1, clickersAny: 2 });
    expect(metrics["step-1"].failedKinds).toEqual([{ kind: "already_replied", count: 1 }]);
    expect(metrics["step-1"].clicks).toEqual([
      { key: "b0", total: 5, people: 2 },
      { key: "t", total: 1, people: 1 },
    ]);
    expect(metrics.cond.exits).toEqual({ true: 4 });
  });
});

describe("textos", () => {
  it("un porcentaje sin base es una raya, nunca 0 %", () => {
    expect(percent(0, 0)).toBe("—");
    expect(percent(1, 2)).toBe("50 %");
    expect(percent(1, 30)).toBe("3,3 %");
    expect(percent(0, 5)).toBe("0 %");
  });

  it("la insignia muestra las personas y los fallos", () => {
    expect(badgeText(undefined)).toBeNull();
    expect(badgeText(buildNodeMetrics([{ node_id: "a", metric: "passed", key: null, value: 1200 }]).a)).toBe("1.200");
    const withFailures = buildNodeMetrics([
      { node_id: "a", metric: "passed", key: null, value: 10 },
      { node_id: "a", metric: "status", key: "failed", value: 3 },
    ]).a;
    expect(badgeText(withFailures)).toBe("10 · 3 ✕");
  });

  it("nombra los links por el titulo del boton", () => {
    expect(clickKeyLabel("b0", [{ title: "Registrarme" }])).toBe("Botón «Registrarme»");
    expect(clickKeyLabel("b2", [])).toBe("Botón 3");
    expect(clickKeyLabel("t", undefined)).toBe("Link del texto");
    expect(clickKeyLabel("m1-b0", undefined)).toBe("Mensaje 2: Botón 1");
  });

  it("nombra las salidas", () => {
    expect(exitLabel("reply")).toBe("Respondió");
    expect(exitLabel("split-0")).toBe("Camino 1");
    expect(exitLabel("p_ab12cd")).toBe("p_ab12cd");
  });
});

describe("periodos", () => {
  it("reconoce los periodos y arma el rango", () => {
    expect(isMetricPeriod("7d")).toBe(true);
    expect(isMetricPeriod("1y")).toBe(false);
    const now = new Date("2026-11-07T12:00:00Z");
    expect(periodRange("7d", now).from).toBe("2026-10-31T12:00:00.000Z");
    expect(periodRange("all", now).from).toBe("2020-01-01T00:00:00.000Z");
  });
});
