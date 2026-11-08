import { describe, it, expect } from "vitest";
import {
  buildUserData,
  fbcFromFbclid,
  hasMatchData,
  normalizeCountry,
  normalizeEmail,
  normalizeFbc,
  normalizeFbp,
  normalizeIp,
  normalizeNamePart,
  normalizePhoneForMeta,
  sha256,
  splitName,
} from "./normalize";

describe("normalizar como pide Meta", () => {
  it("el hash es SHA-256 en hexadecimal", () => {
    expect(sha256("joe@eg.com")).toMatch(/^[0-9a-f]{64}$/);
    // Vector conocido de SHA-256.
    expect(sha256("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });

  it("email: minúsculas y sin espacios; algo que no es un email, nada", () => {
    expect(normalizeEmail("  Ana.Perez@Mail.COM ")).toBe("ana.perez@mail.com");
    expect(normalizeEmail("no es un email")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("teléfono: solo dígitos, con el código de país y sin el «+»", () => {
    expect(normalizePhoneForMeta("+54 9 11 2233-4455")).toBe("5491122334455");
    expect(normalizePhoneForMeta("0054 9 11 2233 4455")).toBe("5491122334455");
    expect(normalizePhoneForMeta("1234")).toBeNull();
  });

  it("nombre: minúsculas, sin puntuación ni espacios, con las tildes", () => {
    expect(normalizeNamePart("María-José")).toBe("maríajosé");
    expect(normalizeNamePart("O'Neil")).toBe("oneil");
    expect(normalizeNamePart("...")).toBeNull();
  });

  it("nombre y apellido: la primera y la última palabra; un relleno (id o @usuario) no es un nombre", () => {
    expect(splitName("Ana María Pérez")).toEqual({ fn: "ana", ln: "pérez" });
    expect(splitName("Ana")).toEqual({ fn: "ana", ln: null });
    expect(splitName("17841400000000000")).toEqual({ fn: null, ln: null });
    expect(splitName("@usuario_x")).toEqual({ fn: null, ln: null });
    expect(splitName("ana@mail.com")).toEqual({ fn: null, ln: null });
  });

  it("país: dos letras en minúsculas", () => {
    expect(normalizeCountry("AR")).toBe("ar");
    expect(normalizeCountry("Argentina")).toBeNull();
  });

  it("IP: solo una dirección real (no la de relleno de los topes)", () => {
    expect(normalizeIp("190.12.34.56")).toBe("190.12.34.56");
    expect(normalizeIp("2800:810:1::1")).toBe("2800:810:1::1");
    expect(normalizeIp("0.0.0.0")).toBeNull();
    expect(normalizeIp("no")).toBeNull();
  });

  it("fbc y fbp: solo con la forma de las cookies de Meta", () => {
    expect(normalizeFbc("fb.1.1554763741205.AbCdEf123")).toBe("fb.1.1554763741205.AbCdEf123");
    expect(normalizeFbc("AbCdEf123")).toBeNull();
    expect(normalizeFbp("fb.1.1596403881668.1116446470")).toBe("fb.1.1596403881668.1116446470");
    expect(normalizeFbp("fb.1.x.y")).toBeNull();
  });

  it("fbc desde el fbclid, sin tocar las mayúsculas", () => {
    const at = new Date("2026-11-01T12:00:00Z");
    expect(fbcFromFbclid("IwAR0AbCdEfGhIjK", at)).toBe(`fb.1.${at.getTime()}.IwAR0AbCdEfGhIjK`);
    expect(fbcFromFbclid("corto", at)).toBeNull();
    expect(fbcFromFbclid(null, at)).toBeNull();
  });
});

describe("user_data", () => {
  it("hashea lo personal, deja la IP, el navegador y las cookies sin hash, y saca lo que no hay", () => {
    const data = buildUserData({
      emails: ["Ana@Mail.com", "ana@mail.com", null],
      phones: ["+5491122334455", "+5491122334455"],
      displayName: "Ana Pérez",
      country: "AR",
      externalId: "CONTACT-1",
      clientIp: "190.12.34.56",
      userAgent: "Mozilla/5.0",
      fbc: "fb.1.1554763741205.AbCdEf123",
      fbp: null,
    });
    expect(data.em).toEqual([sha256("ana@mail.com")]);
    expect(data.ph).toEqual([sha256("5491122334455")]);
    expect(data.fn).toEqual([sha256("ana")]);
    expect(data.ln).toEqual([sha256("pérez")]);
    expect(data.country).toEqual([sha256("ar")]);
    expect(data.external_id).toEqual([sha256("contact-1")]);
    expect(data.client_ip_address).toBe("190.12.34.56");
    expect(data.client_user_agent).toBe("Mozilla/5.0");
    expect(data.fbc).toBe("fb.1.1554763741205.AbCdEf123");
    expect("fbp" in data).toBe(false);
  });

  it("dos emails distintos viajan los dos", () => {
    expect(buildUserData({ emails: ["a@x.com", "b@x.com"] }).em).toHaveLength(2);
  });

  it("con qué puede reconocer Meta a la persona: el id externo, el nombre o el país solos no alcanzan", () => {
    expect(hasMatchData(buildUserData({ externalId: "c1", displayName: "Ana", country: "AR" }))).toBe(false);
    expect(hasMatchData(buildUserData({ emails: ["a@x.com"] }))).toBe(true);
    expect(hasMatchData(buildUserData({ phones: ["+5491122334455"] }))).toBe(true);
    expect(hasMatchData(buildUserData({ fbp: "fb.1.1596403881668.1116446470" }))).toBe(true);
    expect(hasMatchData(buildUserData({ clientIp: "190.12.34.56" }))).toBe(false);
    expect(hasMatchData(buildUserData({ clientIp: "190.12.34.56", userAgent: "Mozilla/5.0" }))).toBe(true);
  });
});
