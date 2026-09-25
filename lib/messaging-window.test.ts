import { describe, it, expect } from "vitest";
import { isSendable, messagingWindowHours, sendableUntil } from "./messaging-window";

describe("ventana de mensajeria", () => {
  it("Instagram y Facebook: 24 h por default (lo que documenta Meta)", () => {
    expect(messagingWindowHours({ platform: "instagram" })).toBe(24);
    expect(messagingWindowHours({ platform: "facebook", messaging_window_hours: null })).toBe(24);
  });
  it("WhatsApp por Evolution y el resto: sin ventana", () => {
    expect(messagingWindowHours({ platform: "whatsapp" })).toBe(0);
  });
  it("la columna del canal pisa el default; 0 = sin ventana", () => {
    expect(messagingWindowHours({ platform: "instagram", messaging_window_hours: 12 })).toBe(12);
    expect(messagingWindowHours({ platform: "instagram", messaging_window_hours: 0 })).toBe(0);
  });
  it("se cuenta desde el ultimo mensaje del lead; sin ventana no hay limite", () => {
    expect(sendableUntil("2026-09-25T10:00:00.000Z", 24)).toBe("2026-09-26T10:00:00.000Z");
    expect(sendableUntil("2026-09-25T10:00:00.000Z", 0)).toBeNull();
    expect(sendableUntil(null, 24)).toBeNull();
  });
  it("enviable mientras no paso el limite", () => {
    const now = new Date("2026-09-26T09:59:00.000Z");
    expect(isSendable("2026-09-26T10:00:00.000Z", now)).toBe(true);
    expect(isSendable("2026-09-26T09:00:00.000Z", now)).toBe(false);
    expect(isSendable(null, now)).toBe(true);
  });
});
