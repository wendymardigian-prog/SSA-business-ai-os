import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, toCsv } from "./write";

describe("csvCell", () => {
  it("una coma o unas comillas van entre comillas, con las internas duplicadas", () => {
    expect(csvCell('Pago "agencia", octubre')).toBe('"Pago ""agencia"", octubre"');
  });
  it("un salto de línea también", () => {
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("neutraliza fórmulas en los textos", () => {
    expect(csvCell("=SUMA(A1:A2)")).toBe("'=SUMA(A1:A2)");
    expect(csvCell("+54911")).toBe("'+54911");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@usuario")).toBe("'@usuario");
  });
  it("un número negativo NO es una fórmula", () => {
    expect(csvCell(-4.2)).toBe("-4.2");
  });
  it("nulos vacíos y booleanos legibles", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("si");
  });
});

describe("toCsv", () => {
  it("BOM, \\r\\n y encabezado", () => {
    const out = toCsv(["a", "b"], [["x", 1], ["y", 2]]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out).toBe(`${CSV_BOM}a,b\r\nx,1\r\ny,2\r\n`);
  });
  it("las tildes sobreviven", () => {
    expect(toCsv(["concepto"], [["Comisión"]])).toContain("Comisión");
  });
});
