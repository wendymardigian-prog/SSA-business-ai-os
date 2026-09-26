import { describe, it, expect } from "vitest";
import { compare, firstResponseTone, formatDuration } from "./cards";
import { timeTone, sortTeam } from "./team-table";

describe("comparación de tarjetas (F16)", () => {
  it("delta y dirección", () => {
    expect(compare(10, 8)).toMatchObject({ delta: 2, direction: "up" });
    expect(compare(8, 10)).toMatchObject({ delta: -2, direction: "down" });
    expect(compare(5, 5)).toMatchObject({ delta: 0, direction: "flat" });
  });
  it("sin período anterior", () => {
    expect(compare(10, null)).toMatchObject({ delta: null, direction: null });
  });
  it("primera respuesta: bajar es bueno (verde)", () => {
    expect(firstResponseTone(compare(30, 60))).toBe("good");
    expect(firstResponseTone(compare(60, 30))).toBe("bad");
    expect(firstResponseTone(compare(30, null))).toBe("neutral");
  });
  it("formato de duración", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(180)).toBe("3 min");
    expect(formatDuration(7800)).toBe("2 h 10 min");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("tabla Quién responde (F18)", () => {
  it("umbrales de color", () => {
    expect(timeTone(1800)).toBe("ok");
    expect(timeTone(3601)).toBe("warn");
    expect(timeTone(4 * 3600 + 1)).toBe("bad");
    expect(timeTone(null)).toBe("ok");
  });
  it("el agente va primero, después por salientes", () => {
    const rows = [
      { author: "u1", messagesOut: 5, firstResponseMedianSeconds: null, replyMedianSeconds: null, repliesUnder1hPct: null },
      { author: "agent", messagesOut: 2, firstResponseMedianSeconds: null, replyMedianSeconds: null, repliesUnder1hPct: null },
      { author: "u2", messagesOut: 9, firstResponseMedianSeconds: null, replyMedianSeconds: null, repliesUnder1hPct: null },
    ];
    expect(sortTeam(rows).map((r) => r.author)).toEqual(["agent", "u2", "u1"]);
  });
});
