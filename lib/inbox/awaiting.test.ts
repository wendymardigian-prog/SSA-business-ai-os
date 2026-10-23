import { describe, expect, it } from "vitest";
import {
  awaitingQueryBounds,
  awaitingState,
  canMarkNoReply,
  matchesAwaitingFilter,
  noReplyBadge,
  parseAwaitingFilter,
  type AwaitingRow,
} from "./awaiting";

const NOW = new Date("2026-10-23T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const waiting = (extra: Partial<AwaitingRow> = {}): AwaitingRow => ({
  status: "open",
  awaiting_last_inbound_at: hoursAgo(3),
  reply_window_until: inHours(21),
  no_reply_needed_at: null,
  agent_disabled_by_tag_id: null,
  contacts: { do_not_contact: false },
  ...extra,
});

describe("awaitingState", () => {
  it("espera y todavia se puede responder", () => {
    expect(awaitingState(waiting(), NOW)).toBe("can_reply");
  });

  it("un canal sin ventana siempre se puede responder", () => {
    expect(awaitingState(waiting({ reply_window_until: null, awaiting_last_inbound_at: hoursAgo(500) }), NOW)).toBe("can_reply");
  });

  it("la ventana ya cerro", () => {
    expect(awaitingState(waiting({ awaiting_last_inbound_at: hoursAgo(30), reply_window_until: hoursAgo(6) }), NOW)).toBe("window_closed");
  });

  it("marcada como que no necesita respuesta gana a la ventana", () => {
    expect(awaitingState(waiting({ no_reply_needed_at: hoursAgo(1), reply_window_until: hoursAgo(1) }), NOW)).toBe("no_reply_needed");
  });

  it("menos de una hora no cuenta todavia (mismo corte que el dashboard)", () => {
    expect(awaitingState(waiting({ awaiting_last_inbound_at: hoursAgo(0.5) }), NOW)).toBe("none");
  });

  it.each([
    ["cerrada", { status: "closed" }],
    ["no contactar", { contacts: { do_not_contact: true } }],
    ["etiqueta que apago al agente", { agent_disabled_by_tag_id: "tag-1" }],
    ["el ultimo mensaje es nuestro", { awaiting_last_inbound_at: null }],
  ])("%s: no espera", (_name, extra) => {
    expect(awaitingState(waiting(extra as Partial<AwaitingRow>), NOW)).toBe("none");
  });
});

describe("matchesAwaitingFilter", () => {
  it("sin filtro entra todo", () => {
    expect(matchesAwaitingFilter(waiting({ awaiting_last_inbound_at: null }), "", NOW)).toBe(true);
  });

  it("'responder' solo las que se pueden responder", () => {
    expect(matchesAwaitingFilter(waiting(), "responder", NOW)).toBe(true);
    expect(matchesAwaitingFilter(waiting({ reply_window_until: hoursAgo(1) }), "responder", NOW)).toBe(false);
  });

  it("'vencida' solo las de ventana cerrada, sin las que no necesitan respuesta", () => {
    expect(matchesAwaitingFilter(waiting({ reply_window_until: hoursAgo(1) }), "vencida", NOW)).toBe(true);
    expect(matchesAwaitingFilter(waiting({ reply_window_until: hoursAgo(1), no_reply_needed_at: hoursAgo(1) }), "vencida", NOW)).toBe(false);
  });
});

describe("parseAwaitingFilter", () => {
  it("acepta solo los dos valores", () => {
    expect(parseAwaitingFilter("responder")).toBe("responder");
    expect(parseAwaitingFilter("vencida")).toBe("vencida");
    expect(parseAwaitingFilter("1")).toBe("");
    expect(parseAwaitingFilter(null)).toBe("");
  });
});

describe("awaitingQueryBounds", () => {
  it("una hora antes de ahora", () => {
    expect(awaitingQueryBounds(NOW)).toEqual({ waitingBefore: hoursAgo(1), nowIso: NOW.toISOString() });
  });
});

describe("noReplyBadge y canMarkNoReply", () => {
  it("muestra quien lo decidio", () => {
    const badge = noReplyBadge({ no_reply_needed_at: hoursAgo(1), no_reply_needed_reason: "agent", awaiting_last_inbound_at: hoursAgo(2) });
    expect(badge.show).toBe(true);
    expect(badge.detail).toContain("agente");
  });

  it("sin marca no muestra nada", () => {
    expect(noReplyBadge({ no_reply_needed_at: null, no_reply_needed_reason: null, awaiting_last_inbound_at: hoursAgo(2) }).show).toBe(false);
  });

  it("se ofrece marcar solo si el lead espera y no esta marcada", () => {
    expect(canMarkNoReply({ awaiting_last_inbound_at: hoursAgo(2), no_reply_needed_at: null })).toBe(true);
    expect(canMarkNoReply({ awaiting_last_inbound_at: null, no_reply_needed_at: null })).toBe(false);
    expect(canMarkNoReply({ awaiting_last_inbound_at: hoursAgo(2), no_reply_needed_at: hoursAgo(1) })).toBe(false);
  });
});
