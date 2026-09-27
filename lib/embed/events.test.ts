import { describe, it, expect } from "vitest";
import { serializeEmbedEvent, parseEmbedMessage, embedMessage, isTrustedOrigin, EMBED_EVENTS, isEmbedEventName } from "./events";

describe("eventos del embed (F41)", () => {
  const booking = {
    uid: "u1",
    start_at: "2026-10-06T20:00:00.000Z",
    end_at: "2026-10-06T20:30:00.000Z",
    meet_url: "https://meet.google.com/abc",
    booker_email: "a@b.com",
    booker_phone: "+50688881234",
    responses: { presupuesto: "1000" },
  };

  it("ssa:bookingSuccessful lleva exactamente uid, startTime, endTime, eventSlug y meetUrl", () => {
    const ev = serializeEmbedEvent("ssa:bookingSuccessful", booking, "llamada");
    expect(ev).toEqual({
      type: "ssa:bookingSuccessful",
      payload: { uid: "u1", startTime: "2026-10-06T20:00:00.000Z", endTime: "2026-10-06T20:30:00.000Z", eventSlug: "llamada", meetUrl: "https://meet.google.com/abc" },
    });
    expect(Object.keys(ev.payload).sort()).toEqual(["endTime", "eventSlug", "meetUrl", "startTime", "uid"]);
  });

  it("nunca incluye email, teléfono ni respuestas; sin Meet no hay clave meetUrl", () => {
    const ev = serializeEmbedEvent("ssa:bookingCancelled", { ...booking, meet_url: null }, "llamada");
    const json = JSON.stringify(ev);
    expect(json).not.toContain("a@b.com");
    expect(json).not.toContain("50688881234");
    expect(json).not.toContain("presupuesto");
    expect("meetUrl" in ev.payload).toBe(false);
  });

  it("los cinco eventos públicos del plano", () => {
    expect([...EMBED_EVENTS]).toEqual(["ssa:bookerReady", "ssa:slotSelected", "ssa:bookingSuccessful", "ssa:rescheduleSuccessful", "ssa:bookingCancelled"]);
    expect(isEmbedEventName("ssa:loaded")).toBe(false);
  });

  it("parseEmbedMessage acepta solo nuestros mensajes", () => {
    const msg = embedMessage("ssa:height", { height: 720 }, "");
    expect(parseEmbedMessage(msg)).toEqual({ source: "ssa-embed", type: "ssa:height", namespace: "", payload: { height: 720 } });
    expect(parseEmbedMessage({ type: "ssa:height" })).toBeNull();
    expect(parseEmbedMessage({ source: "ssa-embed", type: "otro" })).toBeNull();
    expect(parseEmbedMessage("texto")).toBeNull();
  });

  it("isTrustedOrigin compara esquema, host y puerto", () => {
    expect(isTrustedOrigin("https://agenda.ejemplo.com", "https://agenda.ejemplo.com/")).toBe(true);
    expect(isTrustedOrigin("https://agenda.ejemplo.com", ["https://otro.com", "https://agenda.ejemplo.com"])).toBe(true);
    expect(isTrustedOrigin("http://agenda.ejemplo.com", "https://agenda.ejemplo.com")).toBe(false);
    expect(isTrustedOrigin("https://agenda.ejemplo.com.evil.com", "https://agenda.ejemplo.com")).toBe(false);
    expect(isTrustedOrigin("null", "https://agenda.ejemplo.com")).toBe(false);
  });
});
