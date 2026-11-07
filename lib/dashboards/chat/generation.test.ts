import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { minStoredAtFor, nextGeneration, parseGeneration, REFRESH_FLOOR_MS } from "./generation";

describe("parseGeneration", () => {
  it("lee un numero valido", () => {
    expect(parseGeneration("1730000000000")).toBe(1730000000000);
  });

  it("lo que no es una marca vale cero", () => {
    expect(parseGeneration(undefined)).toBe(0);
    expect(parseGeneration("")).toBe(0);
    expect(parseGeneration("hola")).toBe(0);
    expect(parseGeneration("-5")).toBe(0);
    expect(parseGeneration("1.5")).toBe(0);
  });
});

describe("minStoredAtFor", () => {
  const generations = { all: 100, patterns: 200 };

  it("una correccion solo vence Patrones y Calidad", () => {
    expect(minStoredAtFor("patterns", generations)).toBe(200);
    expect(minStoredAtFor("quality", generations)).toBe(200);
    expect(minStoredAtFor("cards", generations)).toBe(100);
    expect(minStoredAtFor("team", generations)).toBe(100);
  });

  it("'Actualizar' vence tambien Patrones", () => {
    expect(minStoredAtFor("patterns", { all: 300, patterns: 200 })).toBe(300);
  });
});

describe("nextGeneration", () => {
  it("apretado seguido no pide todo de nuevo", () => {
    expect(nextGeneration(1000, 1000 + REFRESH_FLOOR_MS - 1)).toBeNull();
  });

  it("pasado el piso, la marca nueva es ahora", () => {
    expect(nextGeneration(1000, 1000 + REFRESH_FLOOR_MS)).toBe(1000 + REFRESH_FLOOR_MS);
    expect(nextGeneration(0, 5_000_000)).toBe(5_000_000);
  });
});
