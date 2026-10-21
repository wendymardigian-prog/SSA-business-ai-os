import { describe, expect, it } from "vitest";
import { comparisonFor, parseCustomFieldRule } from "./custom-field-rule";

describe("parseCustomFieldRule", () => {
  it("lee el formato del editor (slug::valor)", () => {
    expect(parseCustomFieldRule("cantidad_de_viajeros::3")).toEqual({ slug: "cantidad_de_viajeros", value: "3" });
  });
  it("un valor con dos puntos no se corta", () => {
    expect(parseCustomFieldRule("web::https://a.com")).toEqual({ slug: "web", value: "https://a.com" });
  });
  it("una regla vieja con un solo ':' se sigue entendiendo", () => {
    expect(parseCustomFieldRule("empresa:ACME")).toEqual({ slug: "empresa", value: "ACME" });
  });
});

describe("comparisonFor", () => {
  it("número contra value_number (10 > 9, no alfabético)", () => {
    expect(comparisonFor("number", "10")).toEqual({ column: "value_number", value: 10 });
    expect(comparisonFor("number", "3,5")).toEqual({ column: "value_number", value: 3.5 });
    expect(comparisonFor("number", "muchos")).toBeNull();
  });
  it("fecha contra value_date", () => {
    expect(comparisonFor("date", "21/10/2026")).toEqual({ column: "value_date", value: "2026-10-21" });
  });
  it("sí/no normalizado", () => {
    expect(comparisonFor("boolean", "Sí")).toEqual({ column: "value", value: "true" });
  });
  it("texto tal cual", () => {
    expect(comparisonFor("text", " Roma ")).toEqual({ column: "value", value: "Roma" });
  });
});
