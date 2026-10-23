import { describe, expect, it } from "vitest";
import { callLabel, interleaveCalls, isUnansweredCall, parseCallEvent } from "./event";
import { missedCallRecipient } from "./notify";

const now = new Date("2026-10-23T12:00:00Z");

describe("parseCallEvent", () => {
  it("entiende el evento de Baileys que reenvía Evolution", () => {
    expect(
      parseCallEvent({ id: "C1", from: "5491122334455@s.whatsapp.net", isVideo: true, status: "offer", date: "2026-10-23T11:59:00Z", isGroup: false }, now),
    ).toEqual({ callId: "C1", fromJid: "5491122334455@s.whatsapp.net", isVideo: true, event: "offer", at: "2026-10-23T11:59:00.000Z" });
  });

  it("acepta una lista con uno y una fecha en segundos", () => {
    expect(parseCallEvent([{ id: "C2", from: "1@s.whatsapp.net", status: "terminate", date: 1792756800 }], now)?.at).toBe(new Date(1792756800 * 1000).toISOString());
  });

  it("prefiere el teléfono real (callerPn) a un @lid", () => {
    expect(parseCallEvent({ id: "C3", from: "abc@lid", callerPn: "549@s.whatsapp.net", status: "offer" }, now)?.fromJid).toBe("549@s.whatsapp.net");
  });

  it("descarta grupos, estados desconocidos y eventos sin id", () => {
    expect(parseCallEvent({ id: "C4", from: "1@s.whatsapp.net", status: "offer", isGroup: true }, now)).toBeNull();
    expect(parseCallEvent({ id: "C5", from: "1@s.whatsapp.net", status: "otra-cosa" }, now)).toBeNull();
    expect(parseCallEvent({ from: "1@s.whatsapp.net", status: "offer" }, now)).toBeNull();
    expect(parseCallEvent(null, now)).toBeNull();
  });

  it("sin fecha usable, ahora", () => {
    expect(parseCallEvent({ id: "C6", from: "1@s.whatsapp.net", status: "offer", date: "nunca" }, now)?.at).toBe(now.toISOString());
  });
});

describe("callLabel e isUnansweredCall", () => {
  it("dice qué pasó", () => {
    expect(callLabel({ status: "missed", isVideo: false })).toBe("Llamada de voz perdida");
    expect(callLabel({ status: "rejected", isVideo: true })).toBe("Videollamada rechazada");
    expect(callLabel({ status: "answered", isVideo: false })).toBe("Llamada de voz atendida en el celular");
    expect(callLabel({ status: "ringing", isVideo: false })).toBe("Llamada de voz entrante");
    expect(isUnansweredCall("missed")).toBe(true);
    expect(isUnansweredCall("answered")).toBe(false);
  });
});

describe("interleaveCalls", () => {
  it("cada llamada antes del primer mensaje posterior; las últimas, al final", () => {
    const messages = [{ created_at: "2026-10-23T10:00:00Z" }, { created_at: "2026-10-23T12:00:00Z" }];
    const calls = [
      { id: "late", status: "missed", isVideo: false, startedAt: "2026-10-23T13:00:00Z" },
      { id: "mid", status: "missed", isVideo: false, startedAt: "2026-10-23T11:00:00Z" },
      { id: "first", status: "missed", isVideo: false, startedAt: "2026-10-23T09:00:00Z" },
    ];
    const result = interleaveCalls(messages, calls);
    expect(result.before.get(0)?.map((c) => c.id)).toEqual(["first"]);
    expect(result.before.get(1)?.map((c) => c.id)).toEqual(["mid"]);
    expect(result.after.map((c) => c.id)).toEqual(["late"]);
  });
});


describe("missedCallRecipient", () => {
  it("responsable del chat, si no setter, si no vendedor, si no Owner/Admin", () => {
    expect(missedCallRecipient({ assignedTo: "a", setterId: "s", vendedorId: "v" })).toBe("a");
    expect(missedCallRecipient({ assignedTo: null, setterId: "s", vendedorId: "v" })).toBe("s");
    expect(missedCallRecipient({ assignedTo: null, setterId: null, vendedorId: "v" })).toBe("v");
    expect(missedCallRecipient({ assignedTo: null, setterId: null, vendedorId: null })).toBeNull();
  });
});
