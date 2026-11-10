import { describe, it, expect } from "vitest";
import { PHONE_COUNTRIES, findPhoneCountry } from "./phone-countries";
import { callingCountries } from "@/lib/phone-country";
import { joinPhone, splitPhone } from "@/lib/phone-input";

const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Un código de área por cada país que comparte el +1 (y un teléfono de Kazajistán y uno de Rusia para el +7).
const AREA: Record<string, string> = { US: "212", CA: "416", DO: "809", PR: "787", BS: "242", BB: "246", AI: "264", AG: "268", VG: "284", VI: "340", KY: "345", BM: "441", GD: "473", TC: "649", JM: "876", MS: "664", MP: "670", GU: "671", AS: "684", SX: "721", LC: "758", DM: "767", VC: "784", TT: "868", KN: "869" };

describe("la lista de países del selector de teléfono", () => {
  it("trae todos los países (no solo los de uso común) y sin repetir", () => {
    expect(PHONE_COUNTRIES.length).toBeGreaterThan(200);
    const codes = PHONE_COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("los comunes van primero, en su orden de siempre", () => {
    expect(PHONE_COUNTRIES.slice(0, 3).map((c) => c.code)).toEqual(["CR", "AR", "MX"]);
  });

  it("después de los comunes, el resto va ordenado por nombre sin tildes (sin depender de Intl)", () => {
    const start = PHONE_COUNTRIES.findIndex((c) => c.code === "AF");
    const rest = PHONE_COUNTRIES.slice(start).map((c) => plain(c.label));
    expect(rest).toEqual([...rest].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("tiene los mismos países y prefijos que la tabla de prefijos (lib/phone-country.ts), ni uno más ni uno menos", () => {
    const fromTable = new Map(callingCountries().map((c) => [c.code, c.dial]));
    const fromList = new Map(PHONE_COUNTRIES.map((c) => [c.code, c.dial]));
    // Los comunes de la lista incluyen a Estados Unidos y Canadá aunque comparten el +1 con la tabla.
    expect([...fromList.keys()].filter((code) => !fromTable.has(code))).toEqual([]);
    expect([...fromTable.keys()].filter((code) => !fromList.has(code))).toEqual([]);
    for (const [code, dial] of fromTable) expect(fromList.get(code), code).toBe(dial);
  });

  it("países que antes faltaban: Japón, India, Jamaica, Kazajistán", () => {
    expect(findPhoneCountry("JP")?.dial).toBe("81");
    expect(findPhoneCountry("IN")?.dial).toBe("91");
    expect(findPhoneCountry("JM")?.dial).toBe("1");
    expect(findPhoneCountry("KZ")?.dial).toBe("7");
  });

  it("cada país elegido, con un número local, se guarda con su prefijo y vuelve a separarse en el mismo país", () => {
    for (const c of PHONE_COUNTRIES) {
      const number = c.dial === "1" ? `${AREA[c.code]}5550100` : c.code === "KZ" ? "7712345678" : c.code === "RU" ? "9123456789" : "612345678";
      const joined = joinPhone(c.code, number);
      expect(joined, c.code).toBe(`+${c.dial}${number}`);
      const back = splitPhone(joined);
      expect(back.country, c.code).toBe(c.code);
      expect(back.number, c.code).toBe(number);
    }
  });
});
