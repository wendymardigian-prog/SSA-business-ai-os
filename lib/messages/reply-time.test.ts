import { describe, expect, it } from "vitest";
import cases from "./reply-time.cases.json";
import { formatReplyTime, isHumanReply, replyTimesByMessage, type ThreadMessage } from "./reply-time";

describe("isHumanReply: los casos compartidos con el SQL", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(isHumanReply({ origin: c.origin, sentByUserId: c.sentByUserId, secondsSinceLastInbound: c.seconds })).toBe(c.expected);
    });
  }
});

const at = (min: number) => new Date(Date.UTC(2026, 9, 23, 10, 0, 0) + min * 60_000).toISOString();
const msg = (id: string, direction: string, min: number, extra: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id,
  direction,
  created_at: at(min),
  ...extra,
});

describe("replyTimesByMessage", () => {
  it("cuenta desde el PRIMER mensaje sin responder de la tanda", () => {
    const times = replyTimesByMessage([
      msg("a", "inbound", 0),
      msg("b", "inbound", 20),
      msg("c", "outbound", 30, { origin: "user" }),
    ]);
    expect(times.get("c")).toEqual({ seconds: 1800, human: true });
  });

  it("solo la primera respuesta de nuestra tanda lleva el tiempo", () => {
    const times = replyTimesByMessage([
      msg("a", "inbound", 0),
      msg("b", "outbound", 5, { origin: "user" }),
      msg("c", "outbound", 6, { origin: "user" }),
    ]);
    expect([...times.keys()]).toEqual(["b"]);
  });

  it("un envio que fallo no cierra la espera", () => {
    const times = replyTimesByMessage([
      msg("a", "inbound", 0),
      msg("b", "outbound", 5, { origin: "user", status: "failed" }),
      msg("c", "outbound", 10, { origin: "user" }),
    ]);
    expect(times.has("b")).toBe(false);
    expect(times.get("c")?.seconds).toBe(600);
  });

  it("un saliente sin un mensaje del lead antes no tiene tiempo", () => {
    expect(replyTimesByMessage([msg("a", "outbound", 0, { origin: "flow" })]).size).toBe(0);
  });

  it("la respuesta automatica de otra herramienta se marca como no humana", () => {
    const times = replyTimesByMessage([
      { id: "a", direction: "inbound", created_at: "2026-10-23T10:00:00.000Z" },
      { id: "b", direction: "outbound", created_at: "2026-10-23T10:00:02.000Z", origin: "external" },
    ]);
    expect(times.get("b")).toEqual({ seconds: 2, human: false });
  });

  it("ordena por fecha aunque lleguen desordenados", () => {
    const times = replyTimesByMessage([msg("c", "outbound", 10, { origin: "user" }), msg("a", "inbound", 0)]);
    expect(times.get("c")?.seconds).toBe(600);
  });
});

describe("formatReplyTime", () => {
  it.each([
    [0.4, "1 s"],
    [42, "42 s"],
    [240, "4 min"],
    [3600, "1 h"],
    [8100, "2 h 15 min"],
    [86400 * 3 + 3600 * 4, "3 d 4 h"],
    [86400 * 2, "2 d"],
  ])("%s segundos = %s", (s, label) => {
    expect(formatReplyTime(s)).toBe(label);
  });
});
