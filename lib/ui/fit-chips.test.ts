import { describe, expect, it } from "vitest";
import { fitCount } from "./fit-chips";

describe("fitCount: cuántas etiquetas entran en una línea", () => {
  it("sin chips, ninguno", () => {
    expect(fitCount([], 200, 4, 30)).toBe(0);
  });

  it("si entran todos, todos (sin reservar el «+N»)", () => {
    expect(fitCount([50, 50, 50], 158, 4, 30)).toBe(3);
  });

  it("si no entran todos, reserva lugar para el «+N»", () => {
    // 50 + 4 + 50 = 104; + 4 + 30 = 138 <= 140 → 2. Con 3: 158 > 140.
    expect(fitCount([50, 50, 50], 140, 4, 30)).toBe(2);
  });

  it("el «+N» hace que salga uno que sin él entraba", () => {
    // Sin «+N» entrarían 2 (104 <= 110), pero 104 + 4 + 30 > 110 → 1.
    expect(fitCount([50, 50, 50], 110, 4, 30)).toBe(1);
  });

  it("una etiqueta más ancha que la columna se muestra cortada antes que un «+1» solo", () => {
    expect(fitCount([300, 50], 120, 4, 30)).toBe(1);
  });

  it("una sola etiqueta que no entra se muestra igual (cortada)", () => {
    expect(fitCount([300], 120, 4, 30)).toBe(1);
  });

  it("una columna sin lugar ni para un chip y el «+N»: solo el «+N»", () => {
    expect(fitCount([50, 50], 30, 4, 30)).toBe(0);
  });
});
