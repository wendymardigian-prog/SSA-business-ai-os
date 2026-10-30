import { describe, it, expect } from "vitest";
import { summarizeHistory, whatsappTimestampToIso, peopleSenderIds } from "./review";
import { reviewText } from "./review-text";

const chats = [
  { remoteJid: "5491122334455@s.whatsapp.net" },
  { remoteJid: "5491166667777@s.whatsapp.net" },
  { remoteJid: "98765432101234@lid" },
  { remoteJid: "120363001122334455@g.us" },
  { remoteJid: "status@broadcast" },
  { remoteJid: "5491122334455:3@s.whatsapp.net" }, // la misma persona desde otro dispositivo
];

function summarize(over: Partial<Parameters<typeof summarizeHistory>[0]> = {}) {
  return summarizeHistory({
    chats,
    take: 5000,
    knownSenderIds: new Set(["+5491122334455"]),
    totalMessages: 1234,
    oldestMessageAt: "2026-07-01T10:00:00.000Z",
    newestMessageAt: "2026-10-30T10:00:00.000Z",
    connectedAt: "2026-10-16T13:28:43.000Z",
    ...over,
  });
}

describe("summarizeHistory", () => {
  it("cuenta personas (sin grupos ni estados, sin repetir), las sin numero y las que faltan en la bandeja", () => {
    expect(summarize()).toEqual({
      people: 3,
      peopleWithoutNumber: 1,
      missingInInbox: 2,
      groups: 1,
      truncated: false,
      messages: 1234,
      oldestMessageAt: "2026-07-01T10:00:00.000Z",
      newestMessageAt: "2026-10-30T10:00:00.000Z",
      hasHistoryBeforeConnection: true,
    });
  });

  it("sin mensajes anteriores a la conexion, no hay historial previo", () => {
    expect(summarize({ oldestMessageAt: "2026-10-20T00:00:00.000Z" }).hasHistoryBeforeConnection).toBe(false);
    expect(summarize({ oldestMessageAt: null }).hasHistoryBeforeConnection).toBe(false);
  });

  it("si se leyeron tantos chats como el tope, avisa que hay mas", () => {
    expect(summarize({ take: chats.length }).truncated).toBe(true);
  });
});

describe("whatsappTimestampToIso y peopleSenderIds", () => {
  it("segundos, milisegundos y texto; lo invalido es null", () => {
    expect(whatsappTimestampToIso(1_760_000_000)).toBe("2025-10-09T08:53:20.000Z");
    expect(whatsappTimestampToIso("1760000000")).toBe("2025-10-09T08:53:20.000Z");
    expect(whatsappTimestampToIso(1_760_000_000_000)).toBe("2025-10-09T08:53:20.000Z");
    expect(whatsappTimestampToIso(null)).toBeNull();
    expect(whatsappTimestampToIso("x")).toBeNull();
  });

  it("las identidades de las personas, como las guarda la bandeja", () => {
    expect(peopleSenderIds(chats).sort()).toEqual(["+5491122334455", "+5491166667777", "98765432101234@lid"]);
  });
});

describe("reviewText", () => {
  const fmt = (iso: string) => iso.slice(0, 10);

  it("con conversaciones que faltan: lo dice primero y recomienda importar", () => {
    const t = reviewText(summarize(), fmt);
    expect(t.worthImporting).toBe(true);
    expect(t.headline).toBe("2 conversaciones de WhatsApp no están en la bandeja y se podrían traer.");
    expect(t.lines).toEqual([
      "3 conversaciones con personas guardadas en Evolution, 1 de alguien que no compartió su número.",
      "1 grupo: los grupos no se importan.",
      "1.234 mensajes guardados, del 2026-07-01 al 2026-10-30.",
      "Hay mensajes de antes de conectar el número al sistema.",
    ]);
  });

  it("con todo ya en la bandeja, no hay nada que traer", () => {
    const t = reviewText(summarize({ knownSenderIds: new Set(["+5491122334455", "+5491166667777", "98765432101234@lid"]) }), fmt);
    expect(t).toMatchObject({ worthImporting: false, headline: "Todas las conversaciones guardadas en Evolution ya están en la bandeja." });
  });

  it("sin nada guardado en Evolution", () => {
    const t = reviewText(summarize({ chats: [], totalMessages: 0 }), fmt);
    expect(t).toMatchObject({ worthImporting: false, headline: "Evolution no tiene conversaciones guardadas de este número." });
  });

  it("una sola conversacion, en singular", () => {
    const t = reviewText(summarize({ knownSenderIds: new Set(["+5491122334455", "+5491166667777"]) }), fmt);
    expect(t.headline).toBe("1 conversación de WhatsApp no está en la bandeja y se podría traer.");
  });
});
