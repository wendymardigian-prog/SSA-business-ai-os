import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  jidToPhone,
  phoneToJid,
  isGroupJid,
  isLidJid,
  toEvolutionNumber,
} from "./phone";

describe("normalizePhone", () => {
  it("deja siempre +<digitos>, sin importar como venga escrito", () => {
    for (const raw of [
      "+54 9 11 2233-4455",
      "5491122334455",
      "+5491122334455",
      "(549) 11 2233 4455",
      "549.11.2233.4455",
    ]) {
      expect(normalizePhone(raw)).toBe("+5491122334455");
    }
  });

  it("trata el 00 inicial como prefijo internacional", () => {
    expect(normalizePhone("005491122334455")).toBe("+5491122334455");
  });

  it("no confunde un 00 del medio con un prefijo", () => {
    expect(normalizePhone("+34900123456")).toBe("+34900123456");
  });

  it("descarta lo que no es un numero usable", () => {
    for (const raw of [null, undefined, "", "   ", "no-es-un-numero", "12345", "9".repeat(16)]) {
      expect(normalizePhone(raw)).toBeNull();
    }
  });
});

describe("JIDs de WhatsApp", () => {
  it("saca el telefono de un JID individual", () => {
    expect(jidToPhone("5491122334455@s.whatsapp.net")).toBe("+5491122334455");
  });

  it("ignora el sufijo de dispositivo secundario", () => {
    expect(jidToPhone("5491122334455:12@s.whatsapp.net")).toBe("+5491122334455");
  });

  it("no devuelve telefono para grupos ni para JIDs anonimizados", () => {
    // Un mensaje de grupo no tiene un lead detras: no hay que crearle contacto.
    expect(jidToPhone("120363001122334455@g.us")).toBeNull();
    expect(isGroupJid("120363001122334455@g.us")).toBe(true);
    // @lid no trae el numero real, asi que no sirve para deduplicar.
    expect(jidToPhone("98765432101234@lid")).toBeNull();
    expect(isLidJid("98765432101234@lid")).toBe(true);
  });

  it("arma el JID a partir del telefono y vuelve", () => {
    const jid = phoneToJid("+54 9 11 2233-4455");
    expect(jid).toBe("5491122334455@s.whatsapp.net");
    expect(jidToPhone(jid)).toBe("+5491122334455");
  });

  it("phoneToJid devuelve null si el telefono no sirve", () => {
    expect(phoneToJid("1234")).toBeNull();
  });
});

describe("toEvolutionNumber", () => {
  it("manda solo digitos, acepte telefono o JID", () => {
    expect(toEvolutionNumber("+5491122334455")).toBe("5491122334455");
    expect(toEvolutionNumber("5491122334455@s.whatsapp.net")).toBe("5491122334455");
    expect(toEvolutionNumber("120363001122334455@g.us")).toBeNull();
  });
});
