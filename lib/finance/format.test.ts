import { describe, expect, it } from "vitest";
import { formatUsd, formatUsdNumber } from "./format";

describe("formatUsd", () => {
  it("separa miles con punto y decimales con coma", () => {
    expect(formatUsd(124000)).toBe("USD 1.240,00");
    expect(formatUsd(3230)).toBe("USD 32,30");
    expect(formatUsd(0)).toBe("USD 0,00");
  });

  it("un negativo lleva el signo delante (ajustes)", () => {
    expect(formatUsd(-420)).toBe("−USD 4,20");
  });

  it("nunca muestra NaN", () => {
    expect(formatUsd(Number.NaN)).toBe("USD 0,00");
  });

  it("sin prefijo para las tablas", () => {
    expect(formatUsdNumber(96770)).toBe("967,70");
  });
});
