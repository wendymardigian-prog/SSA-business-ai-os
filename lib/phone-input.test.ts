import { describe, expect, it } from "vitest";
import { OTHER_COUNTRY, joinPhone, splitPhone } from "./phone-input";

describe("splitPhone", () => {
  it("separa país y número de lo guardado", () => {
    expect(splitPhone("+50688887777")).toEqual({ country: "CR", number: "88887777" });
    expect(splitPhone("+5491122334455")).toEqual({ country: "AR", number: "91122334455" });
    expect(splitPhone("+14165551234")).toEqual({ country: "CA", number: "4165551234" });
  });
  it("vacío arranca en el país por defecto", () => {
    expect(splitPhone("", "MX")).toEqual({ country: "MX", number: "" });
    expect(splitPhone(null, "XX")).toEqual({ country: "CR", number: "" });
  });
  it("un país fuera de la lista queda en «Otro» con el número entero", () => {
    expect(splitPhone("+819012345678")).toEqual({ country: OTHER_COUNTRY, number: "+819012345678" });
  });
  it("un número viejo sin prefijo se muestra tal cual con el país por defecto", () => {
    expect(splitPhone("8888-7777", "CR")).toEqual({ country: "CR", number: "8888-7777" });
  });
});

describe("joinPhone", () => {
  it("arma el +prefijo+número", () => {
    expect(joinPhone("CR", "8888 7777")).toBe("+50688887777");
    expect(joinPhone("AR", "011 2233-4455")).toBe("+541122334455");
  });
  it("lo escrito con + o 00 manda", () => {
    expect(joinPhone("CR", "+52 55 1234 5678")).toBe("+525512345678");
    expect(joinPhone("CR", "0052 55 1234 5678")).toBe("+525512345678");
  });
  it("vacío es vacío", () => {
    expect(joinPhone("CR", "  ")).toBe("");
  });
  it("ida y vuelta conserva lo guardado", () => {
    for (const v of ["+50688887777", "+5491122334455", "+14165551234", "+819012345678", "+34612345678"]) {
      const p = splitPhone(v);
      expect(joinPhone(p.country, p.number)).toBe(v);
    }
  });
});
