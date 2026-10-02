import { describe, it, expect } from "vitest";
import { buildScatterPoints, pointRadius, type ScatterRunRow } from "./scatter-points";

function row(partial: Partial<ScatterRunRow> & { id: string }): ScatterRunRow {
  return {
    created_at: "2026-09-28T17:00:00Z",
    source: "agent",
    status: "responded",
    cost_usd: 0.01,
    latency_ms: 1000,
    input_tokens: 100,
    total_tokens: 100,
    conversation_id: null,
    ...partial,
  };
}

describe("buildScatterPoints", () => {
  it("error y escalada son rojo (ok: false); el resto, verde", () => {
    const points = buildScatterPoints([
      row({ id: "a", status: "error" }),
      row({ id: "b", status: "escalated" }),
      row({ id: "c", status: "responded" }),
      row({ id: "d", status: "drafted" }),
      row({ id: "e", status: "skipped" }),
    ]);
    expect(points.find((p) => p.id === "a")?.ok).toBe(false);
    expect(points.find((p) => p.id === "b")?.ok).toBe(false);
    expect(points.find((p) => p.id === "c")?.ok).toBe(true);
    expect(points.find((p) => p.id === "d")?.ok).toBe(true);
    expect(points.find((p) => p.id === "e")?.ok).toBe(true);
  });

  it("costo NULL (sin precio) va en el carril 'none', nunca en el logaritmico", () => {
    const [p] = buildScatterPoints([row({ id: "a", cost_usd: null })]);
    expect(p.lane).toBe("none");
    expect(p.costUsd).toBeNull();
  });

  it("costo 0 tambien va en 'none': un log de 0 no existe", () => {
    const [p] = buildScatterPoints([row({ id: "a", cost_usd: 0 })]);
    expect(p.lane).toBe("none");
    expect(p.costUsd).toBe(0);
  });

  it("costo positivo va en el carril de costo", () => {
    const [p] = buildScatterPoints([row({ id: "a", cost_usd: 0.0005 })]);
    expect(p.lane).toBe("cost");
  });
});

describe("pointRadius", () => {
  it("sin tokens en el conjunto (maxTokens 0), da el minimo", () => {
    expect(pointRadius(0, 0)).toBe(3);
  });

  it("el maximo del conjunto da el radio maximo", () => {
    expect(pointRadius(1000, 1000)).toBe(13);
  });

  it("es por raiz cuadrada: la mitad de los tokens no da la mitad del radio", () => {
    const half = pointRadius(500, 1000);
    // raiz(0.5) ~= 0.707, no 0.5
    expect(half).toBeCloseTo(3 + Math.sqrt(0.5) * 10, 5);
    expect(half).toBeGreaterThan(3 + (13 - 3) * 0.5 - 0.01); // mas grande que la interpolacion lineal
  });
});
