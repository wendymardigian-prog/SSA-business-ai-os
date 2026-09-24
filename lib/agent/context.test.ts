import { describe, it, expect } from "vitest";
import { extractBurst, exchangeStart, type StoredMessage } from "./context";

/**
 * La rafaga: que responde un turno. Pura.
 */

const T0 = new Date("2026-09-24T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(T0.getTime() - h * 3_600_000).toISOString();

const msg = (id: string, direction: "inbound" | "outbound", createdAt: string): StoredMessage => ({
  id,
  direction,
  text: `texto ${id}`,
  created_at: createdAt,
  sent_by_user_id: null,
  sent_by_flow_id: null,
  sent_by_agent_id: null,
  agent_run_id: null,
});

describe("extractBurst", () => {
  it("son los entrantes posteriores a la ultima salida", () => {
    const messages = [
      msg("a", "inbound", hoursAgo(3)),
      msg("b", "outbound", hoursAgo(2)),
      msg("c", "inbound", hoursAgo(1)),
      msg("d", "inbound", hoursAgo(0.5)),
    ];
    expect(extractBurst(messages).map((m) => m.id)).toEqual(["c", "d"]);
  });

  it("sin antiguedad maxima, en una conversacion nunca respondida la rafaga es todo el historial (el problema)", () => {
    const messages = [msg("viejo", "inbound", hoursAgo(24 * 21)), msg("nuevo", "inbound", hoursAgo(0.1))];
    expect(extractBurst(messages).map((m) => m.id)).toEqual(["viejo", "nuevo"]);
  });

  it("con antiguedad maxima (default 6 h), lo viejo queda afuera de la rafaga y solo se responde lo reciente", () => {
    const messages = [
      msg("hace-3-semanas", "inbound", hoursAgo(24 * 21)),
      msg("hace-7-horas", "inbound", hoursAgo(7)),
      msg("hace-5-horas", "inbound", hoursAgo(5)),
      msg("recien", "inbound", hoursAgo(0.1)),
    ];
    expect(extractBurst(messages, { maxAgeMs: 6 * 3_600_000, now: T0 }).map((m) => m.id)).toEqual([
      "hace-5-horas",
      "recien",
    ]);
  });

  it("si todo lo pendiente es viejo, la rafaga queda vacia: no hay turno", () => {
    const messages = [msg("viejo", "inbound", hoursAgo(48))];
    expect(extractBurst(messages, { maxAgeMs: 6 * 3_600_000, now: T0 })).toEqual([]);
  });

  it("la antiguedad se cuenta desde el instante del turno, no desde el mensaje mas nuevo", () => {
    // Un mensaje de hace 7 h no revive porque llego uno de ahora.
    const messages = [msg("hace-7-horas", "inbound", hoursAgo(7)), msg("ahora", "inbound", hoursAgo(0))];
    expect(extractBurst(messages, { maxAgeMs: 6 * 3_600_000, now: T0 }).map((m) => m.id)).toEqual(["ahora"]);
  });
});

describe("exchangeStart", () => {
  it("arranca despues del ultimo silencio largo", () => {
    const messages = [msg("a", "inbound", hoursAgo(10)), msg("b", "outbound", hoursAgo(9.9)), msg("c", "inbound", hoursAgo(1))];
    expect(exchangeStart(messages, 120)).toBe(hoursAgo(1));
  });
});
