import { describe, it, expect } from "vitest";
import { logDomain, logFraction, logTicks } from "./log-scale";

describe("logDomain", () => {
  it("sin valores positivos, da un dominio por defecto y no explota (log(0) no existe)", () => {
    expect(logDomain([])).toEqual({ min: 0.001, max: 1 });
    expect(logDomain([0, 0])).toEqual({ min: 0.001, max: 1 });
  });

  it("redondea a potencias de diez que cubren todo el rango", () => {
    expect(logDomain([0.0023, 0.45])).toEqual({ min: 0.001, max: 1 });
  });

  it("un unico valor da igual una decada de alto, para que el eje no quede chato", () => {
    const d = logDomain([0.05]);
    expect(d.max).toBeGreaterThan(d.min);
  });
});

describe("logTicks", () => {
  it("una marca por decada, min y max incluidos", () => {
    expect(logTicks({ min: 0.001, max: 1 })).toEqual([0.001, 0.01, 0.1, 1]);
  });
});

describe("logFraction", () => {
  const domain = { min: 0.001, max: 1 };

  it("el piso del dominio es 0 y el techo es 1", () => {
    expect(logFraction(0.001, domain)).toBeCloseTo(0);
    expect(logFraction(1, domain)).toBeCloseTo(1);
  });

  it("el medio geometrico cae a la mitad", () => {
    expect(logFraction(0.0316227766, domain)).toBeCloseTo(0.5, 3);
  });

  it("un valor fuera del dominio se recorta, no se sale del grafico", () => {
    expect(logFraction(100, domain)).toBeCloseTo(1);
    expect(logFraction(0.00001, domain)).toBeCloseTo(0);
  });
});
