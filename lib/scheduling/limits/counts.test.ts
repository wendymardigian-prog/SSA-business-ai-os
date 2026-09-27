import { describe, it, expect } from "vitest";
import { dayKey, weekKey, countBookings, exceedsLimits } from "./counts";
import { expandWithBuffers, noticeToMinutes, minutesToNotice, effectiveSlotInterval } from "./buffers";

const CR = "America/Costa_Rica";

describe("claves de día y semana", () => {
  it("el día se corta en la zona del horario", () => {
    expect(dayKey("2026-10-07T04:30:00.000Z", CR)).toBe("2026-10-06"); // 22:30 del 6 en CR
  });

  it("la semana empieza el lunes", () => {
    expect(weekKey("2026-10-11T20:00:00.000Z", CR)).toBe("2026-10-05"); // domingo 11 → lunes 5
    expect(weekKey("2026-10-12T20:00:00.000Z", CR)).toBe("2026-10-12"); // lunes 12
  });
});

describe("countBookings / exceedsLimits (F21, F23 tope)", () => {
  const bookings = [
    { start_at: "2026-10-06T15:00:00.000Z" },
    { start_at: "2026-10-06T17:00:00.000Z" },
    { start_at: "2026-10-08T15:00:00.000Z" },
  ];
  const counts = countBookings(bookings, CR);

  it("arma los conteos", () => {
    expect(counts.byDay).toEqual({ "2026-10-06": 2, "2026-10-08": 1 });
    expect(counts.byWeek).toEqual({ "2026-10-05": 3 });
  });

  it("tope de 2 por día con 2 agendas ese día: ese día no ofrece horarios", () => {
    expect(exceedsLimits("2026-10-06T19:00:00.000Z", counts, { maxPerDay: 2 }, CR)).toEqual({
      exceeded: true,
      reason: "max_per_day",
    });
    expect(exceedsLimits("2026-10-08T19:00:00.000Z", counts, { maxPerDay: 2 }, CR).exceeded).toBe(false);
  });

  it("tope semanal", () => {
    expect(exceedsLimits("2026-10-09T19:00:00.000Z", counts, { maxPerWeek: 3 }, CR).reason).toBe("max_per_week");
    expect(exceedsLimits("2026-10-13T19:00:00.000Z", counts, { maxPerWeek: 3 }, CR).exceeded).toBe(false);
  });

  it("vacío o 0 es sin tope", () => {
    expect(exceedsLimits("2026-10-06T19:00:00.000Z", counts, { maxPerDay: null, maxPerWeek: 0 }, CR).exceeded).toBe(false);
  });
});

describe("buffers y aviso", () => {
  it("expandWithBuffers agranda el intervalo", () => {
    expect(
      expandWithBuffers({ startUtc: "2026-10-06T16:00:00.000Z", endUtc: "2026-10-06T16:30:00.000Z" }, 10, 15),
    ).toEqual({ startUtc: "2026-10-06T15:50:00.000Z", endUtc: "2026-10-06T16:45:00.000Z" });
  });

  it("aviso mínimo en unidades", () => {
    expect(noticeToMinutes(2, "hours")).toBe(120);
    expect(noticeToMinutes(1, "days")).toBe(1440);
    expect(minutesToNotice(120)).toEqual({ value: 2, unit: "hours" });
    expect(minutesToNotice(2880)).toEqual({ value: 2, unit: "days" });
    expect(minutesToNotice(45)).toEqual({ value: 45, unit: "minutes" });
  });

  it("intervalo efectivo", () => {
    expect(effectiveSlotInterval(30, null)).toBe(30);
    expect(effectiveSlotInterval(30, 15)).toBe(15);
  });
});
