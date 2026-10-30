import { describe, it, expect } from "vitest";
import { resolveWhatsappSender } from "./whatsapp-sender";

describe("resolveWhatsappSender", () => {
  it("un mensaje con telefono: la identidad es el telefono, como siempre", () => {
    expect(resolveWhatsappSender({ remoteJid: "5491122334455@s.whatsapp.net" })).toEqual({
      id: "+5491122334455",
      phone: "+5491122334455",
      lid: null,
    });
  });

  it("el telefono de un dispositivo secundario pierde el :12", () => {
    expect(resolveWhatsappSender({ remoteJid: "5491122334455:12@s.whatsapp.net" })?.id).toBe("+5491122334455");
  });

  it("un @lid SIN telefono ya no se descarta: la identidad es el @lid", () => {
    expect(resolveWhatsappSender({ remoteJid: "98765432101234@lid" })).toEqual({
      id: "98765432101234@lid",
      phone: null,
      lid: "98765432101234@lid",
    });
  });

  it("un @lid con el telefono real al lado (remoteJidAlt): gana el telefono y se guarda el @lid", () => {
    expect(
      resolveWhatsappSender({ remoteJid: "98765432101234@lid", remoteJidAlt: "5491122334455@s.whatsapp.net" }),
    ).toEqual({ id: "+5491122334455", phone: "+5491122334455", lid: "98765432101234@lid" });
  });

  it("lee el telefono real de los nombres de otras versiones (senderPn, participantPn, participantAlt)", () => {
    for (const field of ["senderPn", "participantPn", "participantAlt"]) {
      expect(
        resolveWhatsappSender({ remoteJid: "98765432101234@lid", [field]: "5491122334455@s.whatsapp.net" })?.phone,
      ).toBe("+5491122334455");
    }
  });

  it("un telefono con el @lid en senderLid guarda los dos", () => {
    expect(
      resolveWhatsappSender({ remoteJid: "5491122334455@s.whatsapp.net", senderLid: "98765432101234@lid" }),
    ).toEqual({ id: "+5491122334455", phone: "+5491122334455", lid: "98765432101234@lid" });
  });

  it("grupos, estados, canales y difusiones no son una persona", () => {
    for (const jid of ["120363001122334455@g.us", "status@broadcast", "1234@broadcast", "1203630011@newsletter"]) {
      expect(resolveWhatsappSender({ remoteJid: jid })).toBeNull();
    }
  });

  it("sin remoteJid, o con algo que no sirve, no hay identidad", () => {
    expect(resolveWhatsappSender(undefined)).toBeNull();
    expect(resolveWhatsappSender({})).toBeNull();
    expect(resolveWhatsappSender({ remoteJid: "abc@s.whatsapp.net" })).toBeNull();
    expect(resolveWhatsappSender({ remoteJid: "12@lid" })).toBeNull();
  });
});
