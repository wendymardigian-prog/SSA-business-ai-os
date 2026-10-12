import { describe, it, expect } from "vitest";
import { COUNTRY_CODES, normalizeCountryText, resolveCountry } from "./country";

describe("resolveCountry", () => {
  it.each([
    ["costa rica", "CR"],
    ["México", "MX"],
    ["Mexico", "MX"],
    ["españa", "ES"],
    ["Spain", "ES"],
    ["cr", "CR"],
    ["CR", "CR"],
    ["  Argentina ", "AR"],
    ["Estados Unidos", "US"],
    ["United States", "US"],
    ["EEUU", "US"],
    ["Brasil", "BR"],
    ["Brazil", "BR"],
    ["Alemania", "DE"],
    ["Germany", "DE"],
    ["Perú", "PE"],
    ["COSTA RICA", "CR"],
    ["UK", "GB"],
  ])("%s → %s", (raw, code) => expect(resolveCountry(raw)).toBe(code));

  it("lo que no es un país da null", () => {
    expect(resolveCountry("Narnia")).toBeNull();
    expect(resolveCountry("ZZ")).toBeNull();
    expect(resolveCountry("")).toBeNull();
    expect(resolveCountry("   ")).toBeNull();
    expect(resolveCountry(42)).toBeNull();
    expect(resolveCountry("x".repeat(200))).toBeNull();
  });

  it("cubre todos los países, no solo los 29 de las listas de teléfono", () => {
    expect(resolveCountry("Nueva Zelanda")).toBe("NZ");
    expect(resolveCountry("Japan")).toBe("JP");
    expect(resolveCountry("Marruecos")).toBe("MA");
  });

  it("la lista tiene los 249 códigos ISO más Kosovo, sin repetidos", () => {
    expect(COUNTRY_CODES).toHaveLength(250);
    expect(new Set(COUNTRY_CODES).size).toBe(250);
  });

  it("todos los códigos se reconocen por su propio nombre en español y en inglés", () => {
    for (const code of COUNTRY_CODES) {
      for (const locale of ["es", "en"]) {
        const name = new Intl.DisplayNames([locale], { type: "region" }).of(code);
        if (name && name !== code) expect(resolveCountry(name), `${code} (${locale}: ${name})`).toBe(code);
      }
    }
  });

  it("los códigos en desuso no cuentan como países", () => {
    expect(resolveCountry("DD")).toBeNull();
    expect(resolveCountry("YU")).toBeNull();
  });

  it("normaliza tildes, mayúsculas y signos", () => {
    expect(normalizeCountryText("  Perú! ")).toBe("peru");
  });
});
