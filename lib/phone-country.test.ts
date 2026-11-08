import { describe, expect, it } from "vitest";
import { countryFromPhone, flagOf } from "./phone-country";

const code = (phone: string | null) => countryFromPhone(phone)?.code ?? null;

describe("countryFromPhone", () => {
  it("gana el prefijo mas largo", () => {
    expect(code("+5491122334455")).toBe("AR");
    expect(code("+528130000000")).toBe("MX");
    expect(code("+51930000000")).toBe("PE");
    expect(code("+50688887777")).toBe("CR");
    expect(code("+59899112233")).toBe("UY");
    expect(code("+593991112222")).toBe("EC");
    expect(code("+34611223344")).toBe("ES");
  });

  it("+1 se decide por el codigo de area: Dominicana, Puerto Rico, Canada y el resto Estados Unidos", () => {
    expect(code("+18095551234")).toBe("DO");
    expect(code("+18295551234")).toBe("DO");
    expect(code("+17875551234")).toBe("PR");
    expect(code("+14165551234")).toBe("CA");
    expect(code("+12125551234")).toBe("US");
    expect(code("+13055551234")).toBe("US");
  });

  it("+7 es Kazajistan con 76 o 77 y Rusia con el resto", () => {
    expect(code("+77011234567")).toBe("KZ");
    expect(code("+79161234567")).toBe("RU");
  });

  it("acepta espacios, guiones y el 00 de marcado internacional", () => {
    expect(code("+54 9 11 2233-4455")).toBe("AR");
    expect(code("0051930000000")).toBe("PE");
  });

  it("sin un numero internacional usable no hay pais", () => {
    expect(code(null)).toBeNull();
    expect(code("")).toBeNull();
    expect(code("1234")).toBeNull();
    expect(code("+0000000000")).toBeNull();
  });

  it("trae nombre en espanol, bandera y prefijo", () => {
    expect(countryFromPhone("+51930000000")).toEqual({ code: "PE", name: "Perú", flag: "🇵🇪", dial: "51" });
    expect(countryFromPhone("+50688887777")?.dial).toBe("506");
  });
});

describe("flagOf", () => {
  it("dos letras regionales, y nada para un codigo invalido", () => {
    expect(flagOf("AR")).toBe("🇦🇷");
    expect(flagOf("ar")).toBe("");
    expect(flagOf("ARG")).toBe("");
  });
});
