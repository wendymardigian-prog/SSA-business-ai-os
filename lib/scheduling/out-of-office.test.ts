import { describe, it, expect } from "vitest";
import { outOfOfficeToUtc, overlapsUtc, OUT_OF_OFFICE_REASONS } from "./out-of-office";

const CR = "America/Costa_Rica";

describe("outOfOfficeToUtc (F13, parte pura)", () => {
  it("20/12 al 31/12 en días completos en Costa Rica → 20/12 06:00Z a 01/01 06:00Z", () => {
    expect(outOfOfficeToUtc({ from: "2026-12-20", to: "2026-12-31", allDay: true }, CR)).toEqual({
      ok: true,
      startsAt: "2026-12-20T06:00:00.000Z",
      endsAt: "2027-01-01T06:00:00.000Z",
    });
  });

  it("un solo día completo cubre 24 horas", () => {
    expect(outOfOfficeToUtc({ from: "2026-10-05", to: "2026-10-05", allDay: true }, CR)).toEqual({
      ok: true,
      startsAt: "2026-10-05T06:00:00.000Z",
      endsAt: "2026-10-06T06:00:00.000Z",
    });
  });

  it("con horas, usa las horas en la zona", () => {
    expect(
      outOfOfficeToUtc(
        { from: "2026-10-05", to: "2026-10-05", allDay: false, fromTime: "13:00", toTime: "15:30" },
        CR,
      ),
    ).toEqual({ ok: true, startsAt: "2026-10-05T19:00:00.000Z", endsAt: "2026-10-05T21:30:00.000Z" });
  });

  it("días completos que cruzan el cambio de horario de New York", () => {
    const r = outOfOfficeToUtc({ from: "2026-03-07", to: "2026-03-08", allDay: true }, "America/New_York");
    expect(r).toEqual({ ok: true, startsAt: "2026-03-07T05:00:00.000Z", endsAt: "2026-03-09T04:00:00.000Z" });
  });

  it("rechaza fin anterior al inicio", () => {
    expect(outOfOfficeToUtc({ from: "2026-12-31", to: "2026-12-20", allDay: true }, CR).ok).toBe(false);
    expect(
      outOfOfficeToUtc(
        { from: "2026-10-05", to: "2026-10-05", allDay: false, fromTime: "15:00", toTime: "13:00" },
        CR,
      ).ok,
    ).toBe(false);
  });

  it("rechaza fechas inválidas y horas faltantes", () => {
    expect(outOfOfficeToUtc({ from: "2026-13-01", to: "2026-12-31", allDay: true }, CR).ok).toBe(false);
    expect(outOfOfficeToUtc({ from: "2026-10-05", to: "2026-10-05", allDay: false }, CR).ok).toBe(false);
  });

  it("los motivos son los cuatro del plano", () => {
    expect(OUT_OF_OFFICE_REASONS).toEqual(["vacation", "travel", "sick", "other"]);
  });
});

describe("overlapsUtc", () => {
  it("detecta superposición y descarta intervalos que solo se tocan", () => {
    const ooo = { startUtc: "2026-12-20T06:00:00.000Z", endUtc: "2027-01-01T06:00:00.000Z" };
    expect(overlapsUtc(ooo, { startUtc: "2026-12-25T15:00:00.000Z", endUtc: "2026-12-25T15:30:00.000Z" })).toBe(true);
    expect(overlapsUtc(ooo, { startUtc: "2027-01-01T06:00:00.000Z", endUtc: "2027-01-01T06:30:00.000Z" })).toBe(false);
  });
});
