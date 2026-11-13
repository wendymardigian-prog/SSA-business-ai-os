import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  jidToPhone,
  phoneToJid,
  isGroupJid,
  isLidJid,
  normalizeLidJid,
  toEvolutionNumber,
  normalizeGroupJid,
} from "./phone";
import { phoneCanonical, phoneVariants } from "./phone";

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

  it("un @lid viaja entero: Evolution lo acepta como destino y le llega a esa persona", () => {
    expect(toEvolutionNumber("98765432101234@lid")).toBe("98765432101234@lid");
    expect(toEvolutionNumber("98765432101234:3@lid")).toBe("98765432101234@lid");
  });
});

describe("normalizeLidJid", () => {
  it("limpia el @lid y descarta lo que no lo es", () => {
    expect(normalizeLidJid("98765432101234:3@lid")).toBe("98765432101234@lid");
    expect(normalizeLidJid("5491122334455@s.whatsapp.net")).toBeNull();
    expect(normalizeLidJid("12@lid")).toBeNull();
    expect(normalizeLidJid(null)).toBeNull();
  });
});

describe("normalizeGroupJid", () => {
  it("deja el JID de un grupo como esta", () => {
    expect(normalizeGroupJid("120363001122334455@g.us")).toBe("120363001122334455@g.us");
    expect(normalizeGroupJid(" 5491122334455-1600000000@g.us ")).toBe("5491122334455-1600000000@g.us");
  });

  it("null para todo lo que no es un grupo", () => {
    expect(normalizeGroupJid("5491122334455@s.whatsapp.net")).toBeNull();
    expect(normalizeGroupJid("98765432101234@lid")).toBeNull();
    expect(normalizeGroupJid("abc@g.us")).toBeNull();
    expect(normalizeGroupJid(null)).toBeNull();
  });
});

describe("phoneVariants y phoneCanonical (00373)", () => {
  it("México: +52 y +521 son el mismo número", () => {
    expect(phoneVariants("+525511112222")).toEqual(["+525511112222", "+5215511112222"]);
    expect(phoneVariants("+52 1 55 1111 2222")).toEqual(["+5215511112222", "+525511112222"]);
    expect(phoneCanonical("+5215511112222")).toBe("+525511112222");
    expect(phoneCanonical("+525511112222")).toBe("+525511112222");
  });
  it("Argentina: +54 y +549 son el mismo número", () => {
    expect(phoneVariants("+5491133334444")).toEqual(["+5491133334444", "+541133334444"]);
    expect(phoneVariants("+541133334444")).toEqual(["+541133334444", "+5491133334444"]);
    expect(phoneCanonical("+5491133334444")).toBe("+541133334444");
  });
  it("otros países, largos distintos o vacío: una sola forma o ninguna", () => {
    expect(phoneVariants("+573001234567")).toEqual(["+573001234567"]);
    expect(phoneVariants("+52551111222")).toEqual(["+52551111222"]);
    expect(phoneVariants("+549112233")).toEqual(["+549112233"]);
    expect(phoneVariants("")).toEqual([]);
    expect(phoneVariants(null)).toEqual([]);
    expect(phoneCanonical("+50688887777")).toBe("+50688887777");
  });
});
