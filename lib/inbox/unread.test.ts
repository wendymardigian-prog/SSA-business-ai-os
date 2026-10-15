import { describe, it, expect } from "vitest";
import { isNewerThanLastInbound, outboundCountsAsAnswered } from "./unread";

describe("outboundCountsAsAnswered", () => {
  it("lo que sale de afuera de la app cuenta (ManyChat, Meta Business Suite, el celular)", () => {
    expect(outboundCountsAsAnswered("external", null)).toBe(true);
  });

  it("lo que escribe una persona en la bandeja cuenta", () => {
    expect(outboundCountsAsAnswered("user", "u-1")).toBe(true);
  });

  it("un borrador del agente que una persona envio cuenta", () => {
    expect(outboundCountsAsAnswered("agent", "u-1")).toBe(true);
  });

  it("una automatizacion de esta app NO cuenta", () => {
    expect(outboundCountsAsAnswered("flow", null)).toBe(false);
    expect(outboundCountsAsAnswered("sequence", null)).toBe(false);
    expect(outboundCountsAsAnswered("broadcast", null)).toBe(false);
    expect(outboundCountsAsAnswered("agent", null)).toBe(false);
  });

  it("sin origen y sin autor no cuenta", () => {
    expect(outboundCountsAsAnswered(null, null)).toBe(false);
    expect(outboundCountsAsAnswered(undefined, undefined)).toBe(false);
  });
});

describe("isNewerThanLastInbound", () => {
  it("sin mensajes del lead, apaga", () => {
    expect(isNewerThanLastInbound("2026-10-14T17:11:00Z", null)).toBe(true);
  });

  it("posterior al ultimo del lead, apaga", () => {
    expect(isNewerThanLastInbound("2026-10-14T17:34:00Z", "2026-10-14T17:11:00Z")).toBe(true);
  });

  it("simultaneo, apaga", () => {
    expect(isNewerThanLastInbound("2026-10-14T17:11:00Z", "2026-10-14T17:11:00Z")).toBe(true);
  });

  it("un eco viejo no tapa un mensaje nuevo del lead", () => {
    expect(isNewerThanLastInbound("2026-10-14T17:00:00Z", "2026-10-14T17:11:00Z")).toBe(false);
  });

  it("una fecha ilegible no apaga nada", () => {
    expect(isNewerThanLastInbound("no-es-fecha", "2026-10-14T17:11:00Z")).toBe(false);
  });
});
