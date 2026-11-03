import { describe, it, expect } from "vitest";
import {
  groupJidOfMessage,
  groupMessageSender,
  parseGroupParticipantsEvent,
  parsePollCreation,
  participantIdentity,
} from "./parse";

const GROUP = "120363001122334455@g.us";

describe("participantIdentity", () => {
  it("el objeto de Baileys v7 con el @lid como id y el telefono al lado: la identidad es el telefono", () => {
    expect(participantIdentity({ id: "98765432101234@lid", phoneNumber: "5491122334455@s.whatsapp.net", admin: null })).toEqual({
      id: "+5491122334455",
      phone: "+5491122334455",
      lid: "98765432101234@lid",
    });
  });

  it("con el telefono como id y el @lid al lado", () => {
    expect(participantIdentity({ id: "5491122334455@s.whatsapp.net", lid: "98765432101234@lid" })).toEqual({
      id: "+5491122334455",
      phone: "+5491122334455",
      lid: "98765432101234@lid",
    });
  });

  it("solo con el @lid: la identidad es el @lid", () => {
    expect(participantIdentity({ id: "98765432101234@lid" })).toEqual({ id: "98765432101234@lid", phone: null, lid: "98765432101234@lid" });
  });

  it("un JID suelto (versiones anteriores) tambien sirve", () => {
    expect(participantIdentity("5491122334455@s.whatsapp.net")?.id).toBe("+5491122334455");
  });

  it("nada utilizable da null", () => {
    expect(participantIdentity({})).toBeNull();
    expect(participantIdentity({ id: GROUP })).toBeNull();
    expect(participantIdentity(42)).toBeNull();
  });
});

describe("parseGroupParticipantsEvent", () => {
  it("una entrada con dos personas (una sin telefono), sin repetidos", () => {
    const event = parseGroupParticipantsEvent({
      id: GROUP,
      author: "5491100000000@s.whatsapp.net",
      action: "add",
      participants: [
        { id: "98765432101234@lid", phoneNumber: "5491122334455@s.whatsapp.net" },
        { id: "11112222333344@lid" },
        { id: "5491122334455@s.whatsapp.net" },
      ],
      participantsData: [{ phoneNumber: "[object Object]" }],
    });
    expect(event).toEqual({
      groupJid: GROUP,
      action: "add",
      participants: [
        { id: "+5491122334455", phone: "+5491122334455", lid: "98765432101234@lid" },
        { id: "11112222333344@lid", phone: null, lid: "11112222333344@lid" },
      ],
    });
  });

  it("una salida", () => {
    expect(parseGroupParticipantsEvent({ id: GROUP, action: "remove", participants: ["5491122334455@s.whatsapp.net"] })?.action).toBe("remove");
  });

  it("sin grupo o con una accion desconocida no se entiende", () => {
    expect(parseGroupParticipantsEvent({ id: "5491122334455@s.whatsapp.net", action: "add", participants: [] })).toBeNull();
    expect(parseGroupParticipantsEvent({ id: GROUP, action: "modify", participants: [] })).toBeNull();
    expect(parseGroupParticipantsEvent(null)).toBeNull();
  });
});

describe("mensajes de un grupo", () => {
  it("el grupo y quien escribio", () => {
    const key = { remoteJid: GROUP, fromMe: false, id: "M1", participant: "98765432101234@lid", participantAlt: "5491122334455@s.whatsapp.net" };
    expect(groupJidOfMessage(key)).toBe(GROUP);
    expect(groupMessageSender(key)).toEqual({ id: "+5491122334455", phone: "+5491122334455", lid: "98765432101234@lid" });
  });

  it("un chat privado no es de un grupo", () => {
    expect(groupJidOfMessage({ remoteJid: "5491122334455@s.whatsapp.net" })).toBeNull();
  });

  it("sin participante no se sabe quien fue", () => {
    expect(groupMessageSender({ remoteJid: GROUP })).toBeNull();
  });
});

describe("parsePollCreation", () => {
  it("lee las tres versiones", () => {
    const node = { name: "¿Qué día?", options: [{ optionName: "Lunes" }, { optionName: "Martes" }, { optionName: "Lunes" }], selectableOptionsCount: 1 };
    for (const key of ["pollCreationMessage", "pollCreationMessageV2", "pollCreationMessageV3"]) {
      expect(parsePollCreation({ [key]: node })).toEqual({ name: "¿Qué día?", options: ["Lunes", "Martes"], selectableCount: 1 });
    }
  });

  it("0 opciones elegibles = todas", () => {
    expect(parsePollCreation({ pollCreationMessage: { name: "X", options: [], selectableOptionsCount: 0 } })?.selectableCount).toBe(0);
  });

  it("un mensaje comun no es una encuesta", () => {
    expect(parsePollCreation({ conversation: "hola" })).toBeNull();
    expect(parsePollCreation({ pollCreationMessage: { options: [] } })).toBeNull();
  });
});
