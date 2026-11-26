import { describe, expect, it } from "vitest";
import { TOUCH_HOLD_MS, TOUCH_OPEN_MS, touchMovedTooFar } from "./tooltip-touch";

describe("tooltip en pantalla tactil", () => {
  it("se abre al mantener medio segundo y queda abierto 3 s", () => {
    expect(TOUCH_HOLD_MS).toBe(500);
    expect(TOUCH_OPEN_MS).toBe(3000);
  });

  it("un movimiento chico sigue siendo mantener; uno grande es desplazar", () => {
    expect(touchMovedTooFar({ x: 10, y: 10 }, { x: 16, y: 14 })).toBe(false);
    expect(touchMovedTooFar({ x: 10, y: 10 }, { x: 10, y: 25 })).toBe(true);
  });
});
