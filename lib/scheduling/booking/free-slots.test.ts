import { describe, expect, it } from "vitest";
import { firstFreeSlots, freeSlotLabel, slotToWallClock } from "./free-slots";

describe("firstFreeSlots", () => {
  it("junta los días, ordena, saca los repetidos y los que ya pasaron", () => {
    const byDay = {
      "2026-11-26": [{ startUtc: "2026-11-26T15:00:00.000Z" }, { startUtc: "2026-11-26T14:00:00.000Z" }],
      "2026-11-25": [{ startUtc: "2026-11-25T10:00:00.000Z" }, { startUtc: "2026-11-25T20:00:00.000Z" }, { startUtc: "2026-11-25T20:00:00.000Z" }],
    };
    expect(firstFreeSlots(byDay, "2026-11-25T12:00:00.000Z", 3)).toEqual(["2026-11-25T20:00:00.000Z", "2026-11-26T14:00:00.000Z", "2026-11-26T15:00:00.000Z"]);
  });
  it("sin horarios, vacío", () => expect(firstFreeSlots({}, "2026-11-25T00:00:00.000Z")).toEqual([]));
});

describe("en la zona de quien agenda", () => {
  it("día y hora del formulario", () => expect(slotToWallClock("2026-11-25T15:30:00.000Z", "America/Argentina/Buenos_Aires")).toEqual({ date: "2026-11-25", time: "12:30" }));
  it("la etiqueta", () => expect(freeSlotLabel("2026-11-25T15:30:00.000Z", "America/Argentina/Buenos_Aires")).toMatch(/25 nov · 12:30$/));
});
