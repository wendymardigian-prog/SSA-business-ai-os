import { describe, it, expect } from "vitest";
import { formatRemaining, isAboutToExpire, windowInfo } from "./window-state";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe("estado de la ventana: cortes derivados de W", () => {
  it.each([
    [13, "relaxed"],
    [12, "warning"],
    [7, "warning"],
    [6, "urgent"],
    [3.5, "urgent"],
    [3, "last_call"],
    [0.1, "last_call"],
    [-1, "closed"],
  ])("con W = 24 y %s h restantes: %s", (hours, level) => {
    expect(windowInfo(inHours(hours as number), 24, NOW).level).toBe(level);
  });

  it("con W = 8 los cortes son 4, 2 y 1 h (nunca constantes en horas)", () => {
    expect(windowInfo(inHours(5), 8, NOW).level).toBe("relaxed");
    expect(windowInfo(inHours(3), 8, NOW).level).toBe("warning");
    expect(windowInfo(inHours(1.5), 8, NOW).level).toBe("urgent");
    expect(windowInfo(inHours(0.5), 8, NOW).level).toBe("last_call");
  });

  it("sin ventana no hay estado", () => {
    expect(windowInfo(null, 24, NOW).level).toBe("none");
    expect(windowInfo(inHours(2), 0, NOW).level).toBe("none");
  });

  it("por vencer = urgente o ultima llamada", () => {
    expect(isAboutToExpire(windowInfo(inHours(5), 24, NOW))).toBe(true);
    expect(isAboutToExpire(windowInfo(inHours(9), 24, NOW))).toBe(false);
    expect(isAboutToExpire(windowInfo(inHours(-1), 24, NOW))).toBe(false);
  });

  it("texto del tiempo", () => {
    expect(formatRemaining(windowInfo(inHours(5 + 1 / 3), 24, NOW))).toBe("quedan 5 h 20 min");
    expect(formatRemaining(windowInfo(inHours(-2), 24, NOW))).toBe("cerró hace 2 h");
  });
});
