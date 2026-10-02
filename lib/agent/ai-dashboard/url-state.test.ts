import { describe, it, expect } from "vitest";
import { DEFAULT_AI_PERIOD, parsePeriodFilter, periodFilterToParams } from "./url-state";

describe("parsePeriodFilter", () => {
  it("sin nada en la URL, cae al default (30d)", () => {
    expect(parsePeriodFilter(new URLSearchParams())).toEqual({ period: DEFAULT_AI_PERIOD, from: null, to: null });
  });

  it("un preset valido se toma tal cual", () => {
    expect(parsePeriodFilter(new URLSearchParams("range=este-mes"))).toMatchObject({ period: "este-mes" });
  });

  it("un preset invalido cae al default, no rompe", () => {
    expect(parsePeriodFilter(new URLSearchParams("range=la-semana-que-viene"))).toMatchObject({ period: DEFAULT_AI_PERIOD });
  });

  it("un rango a medida con las dos puntas gana al preset", () => {
    const f = parsePeriodFilter(new URLSearchParams("range=7d&from=2026-09-01T06:00:00.000Z&to=2026-09-10T06:00:00.000Z"));
    expect(f).toEqual({ period: "7d", from: "2026-09-01T06:00:00.000Z", to: "2026-09-10T06:00:00.000Z" });
  });

  it("con una sola punta, el rango a medida no cuenta: vuelve al preset solo", () => {
    const f = parsePeriodFilter(new URLSearchParams("range=7d&from=2026-09-01T06:00:00.000Z"));
    expect(f).toEqual({ period: "7d", from: null, to: null });
  });

  it("una fecha invalida en from/to no rompe, se descarta", () => {
    const f = parsePeriodFilter(new URLSearchParams("from=no-es-una-fecha&to=2026-09-10T06:00:00.000Z"));
    expect(f.from).toBeNull();
    expect(f.to).toBeNull();
  });
});

describe("periodFilterToParams", () => {
  it("el default no deja rastro en la URL", () => {
    expect(periodFilterToParams({ period: DEFAULT_AI_PERIOD, from: null, to: null }).toString()).toBe("");
  });

  it("un preset distinto del default se escribe como range", () => {
    expect(periodFilterToParams({ period: "historico", from: null, to: null }).toString()).toBe("range=historico");
  });

  it("un rango a medida escribe from y to, no range", () => {
    const p = periodFilterToParams({ period: "7d", from: "2026-09-01T06:00:00.000Z", to: "2026-09-10T06:00:00.000Z" });
    expect(p.get("from")).toBe("2026-09-01T06:00:00.000Z");
    expect(p.get("to")).toBe("2026-09-10T06:00:00.000Z");
    expect(p.has("range")).toBe(false);
  });

  it("ida y vuelta: parsear lo que se serializo da lo mismo", () => {
    const original = { period: "60d" as const, from: null, to: null };
    expect(parsePeriodFilter(periodFilterToParams(original))).toEqual(original);
  });
});
