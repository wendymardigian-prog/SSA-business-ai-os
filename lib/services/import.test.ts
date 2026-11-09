// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { importKey, parseImportDate, parseServicesImport } from "./import";

const HEAD = "Email,Producto,Variante,Inicio,Fin,Responsable,Fase actual";

describe("parseServicesImport (F99)", () => {
  it("lee las filas buenas", () => {
    const r = parseServicesImport(`${HEAD}\nana@ejemplo.com,Programa X,12 semanas,2026-11-01,,lu@ejemplo.com,Onboarding`);
    expect(r.missingColumns).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, email: "ana@ejemplo.com", phone: null, product: "Programa X", variant: "12 semanas", startsOn: "2026-11-01", endsOn: null, ownerEmail: "lu@ejemplo.com", phase: "Onboarding" },
    ]);
  });
  it("da los errores por fila", () => {
    const r = parseServicesImport(`${HEAD}\n,Programa X,12 semanas,31/02/2026,,lu@ejemplo.com,\nbea@ejemplo.com,,12 semanas,2026-11-01,2026-10-01,,`);
    expect(r.errors).toEqual([
      { line: 2, problems: ["falta el email o el teléfono del contacto", "la fecha de inicio no es válida (AAAA-MM-DD o DD/MM/AAAA)"] },
      { line: 3, problems: ["falta el producto", "el fin es antes del inicio", "falta el email del responsable"] },
    ]);
  });
  it("una fila repetida en el archivo se marca", () => {
    const row = "ana@ejemplo.com,Programa X,12 semanas,2026-11-01,,lu@ejemplo.com,";
    const r = parseServicesImport(`${HEAD}\n${row}\n${row}`);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toEqual([{ line: 3, problems: ["la fila está repetida en el archivo"] }]);
  });
  it("pide las columnas que faltan", () => {
    expect(parseServicesImport("Nombre,Producto\nAna,X").missingColumns).toEqual(["email o teléfono", "variante", "inicio", "responsable"]);
  });
  it("acepta DD/MM/AAAA y el separador de Excel en castellano", () => {
    expect(parseImportDate("1/11/2026")).toBe("2026-11-01");
    const r = parseServicesImport("Teléfono;Producto;Variante;Inicio;Responsable\n+5491100000000;Programa X;Light;1/11/2026;lu@ejemplo.com");
    expect(r.rows[0]).toMatchObject({ phone: "+5491100000000", startsOn: "2026-11-01" });
  });
  it("la clave de idempotencia es contacto + producto + inicio", () => {
    expect(importKey("c", "p", "2026-11-01")).toBe("c|p|2026-11-01");
  });
});
