import { describe, it, expect } from "vitest";
import { axisValue, compact, currencySymbol, tooltipValue } from "./formatters";

describe("formatos de los graficos de anuncios", () => {
  it("el simbolo de la moneda es corto", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol(null)).toBe("$");
  });

  it("los numeros largos se abrevian para entrar en el eje", () => {
    expect(compact(950)).toBe("950");
    expect(compact(1500)).toBe("1,5k");
    expect(compact(2_300_000)).toBe("2,3M");
  });

  it("un costo de centavos lleva dos decimales en el eje", () => {
    expect(axisValue("cpc", 0.05, "USD")).toBe("$0,05");
    expect(axisValue("spend", 20, "USD")).toBe("$20");
    expect(axisValue("spend", 12500, "USD")).toBe("$12,5k");
  });

  it("el CTR lleva porcentaje y las cuentas son enteras", () => {
    expect(axisValue("ctr", 3.5, "USD")).toBe("3,5%");
    expect(axisValue("clicks", 1200, "USD")).toBe("1,2k");
  });

  it("el tooltip muestra el valor completo", () => {
    expect(tooltipValue("spend", 11.28, "USD")).toContain("11,28");
    expect(tooltipValue("ctr", 3.74, "USD")).toBe("3.74%");
  });
});
