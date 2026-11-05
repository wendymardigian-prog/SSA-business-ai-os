import { describe, expect, it } from "vitest";
import type { EvolutionStoredMessage } from "@/lib/evolution-client";
import { parseAttachments } from "@/lib/messages/attachments";
import { historicMessageFrom, importedConversationStatus, planChatImport } from "./import-chat";

const LID = "98765432101234@lid";
const PHONE_JID = "5491122334455@s.whatsapp.net";

function msg(over: Partial<EvolutionStoredMessage> & { id?: string; at?: number; fromMe?: boolean; text?: string } = {}): EvolutionStoredMessage {
  const { id = "m1", at = 1_761_800_000, fromMe = false, text = "hola", ...rest } = over;
  return {
    key: { id, fromMe, remoteJid: LID },
    pushName: fromMe ? "Wendy" : "Ana",
    message: { conversation: text },
    messageTimestamp: at,
    ...rest,
  };
}

describe("historicMessageFrom", () => {
  it("un texto entra con su direccion y su fecha real", () => {
    expect(historicMessageFrom(msg({ text: "ANALIZADOR" }))).toEqual({
      platformMessageId: "m1",
      direction: "inbound",
      text: "ANALIZADOR",
      attachments: null,
      createdAt: new Date(1_761_800_000_000).toISOString(),
    });
    expect(historicMessageFrom(msg({ fromMe: true }))?.direction).toBe("outbound");
  });

  it("lee el texto de un mensaje temporal, que viene envuelto", () => {
    const record = msg({ message: { ephemeralMessage: { message: { conversation: "ACADEMIA" } } } });
    expect(historicMessageFrom(record)?.text).toBe("ACADEMIA");
  });

  it("una reaccion, un voto o un aviso de protocolo no son un mensaje", () => {
    expect(historicMessageFrom(msg({ message: { reactionMessage: { key: { id: "x" }, text: "❤️" } } }))).toBeNull();
    expect(historicMessageFrom(msg({ message: { protocolMessage: { type: 0 } } }))).toBeNull();
  });

  it("sin id o sin fecha no entra: no se podria deduplicar ni ordenar", () => {
    expect(historicMessageFrom({ ...msg(), key: { fromMe: false } })).toBeNull();
    expect(historicMessageFrom({ ...msg(), messageTimestamp: null })).toBeNull();
  });

  it("un audio queda sin spinner: nadie va a bajar el archivo", () => {
    const record = msg({ message: { audioMessage: { ptt: true, mimetype: "audio/ogg", seconds: 4 } } });
    const items = parseAttachments(historicMessageFrom(record)?.attachments);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("voice");
    expect(items[0].status).toBe("none");
  });
});

describe("planChatImport", () => {
  it("un grupo o un chat sin mensajes reales no crean un contacto vacio", () => {
    expect(planChatImport({ remoteJid: "120363001122334455@g.us" }, [msg()])).toBeNull();
    expect(planChatImport({ remoteJid: LID }, [msg({ message: { protocolMessage: {} } })])).toBeNull();
  });

  it("recupera el telefono de cualquier mensaje del chat, aunque el chat sea un @lid", () => {
    const withPhone = msg({ id: "m2" });
    withPhone.key = { ...withPhone.key, remoteJidAlt: PHONE_JID };
    const plan = planChatImport({ remoteJid: LID }, [msg(), withPhone]);
    expect(plan?.sender).toEqual({ id: "+5491122334455", phone: "+5491122334455", lid: LID });
  });

  it("sin telefono en ningun lado, la identidad es el @lid", () => {
    const plan = planChatImport({ remoteJid: LID }, [msg()]);
    expect(plan?.sender).toEqual({ id: LID, phone: null, lid: LID });
  });

  it("los mensajes van del mas viejo al mas nuevo, sin repetidos, y el preview es el ultimo", () => {
    const plan = planChatImport({ remoteJid: LID }, [
      msg({ id: "nuevo", at: 1_761_900_000, text: "chau" }),
      msg({ id: "viejo", at: 1_761_800_000, text: "hola" }),
      msg({ id: "viejo", at: 1_761_800_000, text: "hola" }),
    ]);
    expect(plan?.messages.map((m) => m.platformMessageId)).toEqual(["viejo", "nuevo"]);
    expect(plan?.preview).toBe("chau");
    expect(plan?.lastAt).toBe(new Date(1_761_900_000_000).toISOString());
  });

  it("el nombre es el de la persona, nunca el nuestro de un mensaje saliente", () => {
    const plan = planChatImport({ remoteJid: LID }, [msg({ id: "yo", at: 1_761_900_000, fromMe: true }), msg({ id: "ella" })]);
    expect(plan?.name).toBe("Ana");
  });

  it("si solo escribimos nosotros, no usa el nombre del chat cuando el ultimo mensaje es nuestro", () => {
    const chat = { remoteJid: LID, pushName: "Wendy", lastMessage: { key: { fromMe: true } } };
    expect(planChatImport(chat, [msg({ fromMe: true })])?.name).toBe("Contacto de WhatsApp");
    const withPhone = { remoteJid: PHONE_JID, pushName: "Wendy", lastMessage: { key: { fromMe: true } } };
    expect(planChatImport(withPhone, [msg({ fromMe: true })])?.name).toBe("+5491122334455");
  });
});

describe("importedConversationStatus", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  it("sin movimiento hace mas de 7 dias nace cerrada: no llena Esperando respuesta", () => {
    expect(importedConversationStatus("2026-10-01T12:00:00.000Z", now)).toBe("closed");
    expect(importedConversationStatus("2026-11-03T12:00:00.000Z", now)).toBe("open");
  });
});
