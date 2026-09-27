// Casos adaptados de `packages/features/schedules/lib/slots.test.ts` de Cal.diy (MIT).
import { describe, it, expect } from "vitest";
import { splitIntoSlots, alignUp, alignmentUnit } from "./slots";

const day = (d: string) => ({ start: Date.parse(`${d}T00:00:00.000Z`), end: Date.parse(`${d}T24:00:00.000Z`) });
const at = (iso: string) => Date.parse(iso);

describe("splitIntoSlots (portado de Cal.diy)", () => {
  it("entran 24 horarios de una hora en un día vacío", () => {
    expect(splitIntoSlots([day("2021-06-21")], { durationMinutes: 60, intervalMinutes: 60, tz: "UTC" })).toHaveLength(24);
  });

  it("24 horarios con intervalo distinto de la duración", () => {
    expect(splitIntoSlots([day("2021-06-21")], { durationMinutes: 30, intervalMinutes: 60, tz: "UTC" })).toHaveLength(24);
  });

  it("72 horarios de 20 minutos en un día", () => {
    expect(splitIntoSlots([day("2021-06-21")], { durationMinutes: 20, intervalMinutes: 20, tz: "UTC" })).toHaveLength(72);
  });

  it("varias ventanas dan varios grupos", () => {
    const windows = [
      { start: at("2021-06-21T11:00:00Z"), end: at("2021-06-21T12:00:00Z") },
      { start: at("2021-06-21T14:00:00Z"), end: at("2021-06-21T15:00:00Z") },
    ];
    expect(splitIntoSlots(windows, { durationMinutes: 20, intervalMinutes: 20, tz: "UTC" })).toHaveLength(6);
  });

  it("el último horario del día entra", () => {
    const slots = splitIntoSlots([day("2021-06-21")], { durationMinutes: 60, intervalMinutes: 60, tz: "UTC" });
    expect(slots.at(-1)?.startUtc).toBe("2021-06-21T23:00:00.000Z");
  });

  it("zonas con media hora de corrimiento (Asia/Kolkata) alinean a la hora local", () => {
    // 04:30Z = 10:00 en Kolkata. Ventana 04:30Z–06:30Z → 10:00, 11:00 local.
    const slots = splitIntoSlots([{ start: at("2021-06-21T04:30:00Z"), end: at("2021-06-21T06:30:00Z") }], {
      durationMinutes: 60,
      intervalMinutes: 60,
      tz: "Asia/Kolkata",
    });
    expect(slots.map((s) => s.startUtc)).toEqual(["2021-06-21T04:30:00.000Z", "2021-06-21T05:30:00.000Z"]);
  });

  it("eventos de 5 minutos", () => {
    const slots = splitIntoSlots([{ start: at("2021-06-21T09:00:00Z"), end: at("2021-06-21T10:00:00Z") }], {
      durationMinutes: 5,
      intervalMinutes: 5,
      tz: "UTC",
    });
    expect(slots).toHaveLength(12);
  });

  it("eventos de 40 minutos se alinean a 20 y avanzan de a 40", () => {
    const slots = splitIntoSlots([{ start: at("2021-06-21T09:10:00Z"), end: at("2021-06-21T12:00:00Z") }], {
      durationMinutes: 40,
      intervalMinutes: 40,
      tz: "UTC",
    });
    expect(slots.map((s) => s.startUtc)).toEqual([
      "2021-06-21T09:20:00.000Z",
      "2021-06-21T10:00:00.000Z",
      "2021-06-21T10:40:00.000Z",
      "2021-06-21T11:20:00.000Z",
    ]);
  });

  it("un hueco que arranca a las 10:45 con intervalo 30 ofrece 11:00", () => {
    const slots = splitIntoSlots([{ start: at("2021-06-21T10:45:00Z"), end: at("2021-06-21T12:00:00Z") }], {
      durationMinutes: 30,
      intervalMinutes: 30,
      tz: "UTC",
    });
    expect(slots.map((s) => s.startUtc)).toEqual(["2021-06-21T11:00:00.000Z", "2021-06-21T11:30:00.000Z"]);
  });

  it("alignUp y alignmentUnit", () => {
    expect(alignmentUnit(30)).toBe(30);
    expect(alignmentUnit(45)).toBe(15);
    expect(alignmentUnit(40)).toBe(20);
    expect(alignmentUnit(7)).toBe(1);
    expect(new Date(alignUp(at("2021-06-21T10:45:00Z"), "UTC", 30)).toISOString()).toBe("2021-06-21T11:00:00.000Z");
    expect(new Date(alignUp(at("2021-06-21T10:30:00Z"), "UTC", 30)).toISOString()).toBe("2021-06-21T10:30:00.000Z");
    expect(new Date(alignUp(at("2021-06-21T10:30:01Z"), "UTC", 30)).toISOString()).toBe("2021-06-21T11:00:00.000Z");
  });
});
