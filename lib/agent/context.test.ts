import { describe, it, expect } from "vitest";
import { countAgentReplies, extractBurst, exchangeStart, lastHumanReplyAt, type StoredMessage } from "./context";
import { memoryDb } from "./testing/memory-db";

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

describe("lastHumanReplyAt y countAgentReplies con borradores (00070)", () => {
  const out = (id: string, created_at: string, who: { user?: string; agent?: string }) => ({
    id,
    conversation_id: "cv-1",
    direction: "outbound",
    text: "x",
    created_at,
    sent_by_user_id: who.user ?? null,
    sent_by_agent_id: who.agent ?? null,
  });

  it("un borrador aprobado (agente + persona) NO es una respuesta humana", async () => {
    const db = memoryDb({
      messages: [
        out("m1", "2026-09-15T10:00:00.000Z", { user: "u-1" }),
        out("m2", "2026-09-15T11:00:00.000Z", { user: "u-1", agent: "agent-1" }),
      ],
    });
    expect(await lastHumanReplyAt(db.client, "cv-1")).toBe("2026-09-15T10:00:00.000Z");
  });

  it("cuenta los runs responded y los borradores enviados; no los descartados", async () => {
    const db = memoryDb({
      agent_runs: [
        { id: "r1", conversation_id: "cv-1", source: "agent", status: "responded", created_at: "2026-09-15T12:00:00.000Z" },
        { id: "r2", conversation_id: "cv-1", source: "agent", status: "drafted", created_at: "2026-09-15T12:05:00.000Z" },
      ],
      agent_drafts: [
        { id: "d1", conversation_id: "cv-1", status: "sent", decided_at: "2026-09-15T12:10:00.000Z" },
        { id: "d2", conversation_id: "cv-1", status: "discarded", decided_at: "2026-09-15T12:20:00.000Z" },
        { id: "d3", conversation_id: "cv-1", status: "sent", decided_at: "2026-09-15T09:00:00.000Z" },
      ],
    });
    expect(await countAgentReplies(db.client, { conversationId: "cv-1", since: "2026-09-15T10:00:00.000Z" })).toBe(2);
  });
});
