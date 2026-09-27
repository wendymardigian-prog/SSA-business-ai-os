import { describe, it, expect } from "vitest";
import { placeInCalendar } from "./calendar-view";
import type { BookingStatus } from "./types";

const CR = "America/Costa_Rica";
const b = (status: BookingStatus, start: string, end: string, event_color: string | null = "#2563eb") => ({ status, start_at: start, end_at: end, event_color });

describe("placeInCalendar (F35)", () => {
  it("una agenda de 23:30 a 00:30 hora local queda en el día de inicio, marcada como que cruza la medianoche", () => {
    const r = placeInCalendar([b("scheduled", "2026-10-07T05:30:00.000Z", "2026-10-07T06:30:00.000Z")], CR, "week");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ date: "2026-10-06", startMinutes: 1410, endMinutes: 1470, crossesMidnight: true });
    expect(r.byDate["2026-10-06"]).toHaveLength(1);
    expect(r.byDate["2026-10-07"]).toBeUndefined();
  });

  it("una agenda común no cruza y lleva color de estado y de evento", () => {
    const r = placeInCalendar([b("confirmed", "2026-10-06T15:00:00.000Z", "2026-10-06T15:30:00.000Z", "#dc2626")], CR, "day");
    expect(r.items[0]).toMatchObject({ date: "2026-10-06", startMinutes: 540, endMinutes: 570, crossesMidnight: false, statusColor: "green", statusLabel: "Confirmada", eventColor: "#dc2626" });
  });

  it("las canceladas se ocultan salvo includeCancelled", () => {
    const list = [b("cancelled_other", "2026-10-06T15:00:00.000Z", "2026-10-06T15:30:00.000Z"), b("scheduled", "2026-10-06T16:00:00.000Z", "2026-10-06T16:30:00.000Z")];
    expect(placeInCalendar(list, CR, "month").items).toHaveLength(1);
    expect(placeInCalendar(list, CR, "month", { includeCancelled: true }).items).toHaveLength(2);
  });

  it("con range, incluye los días vacíos y ordena por inicio", () => {
    const r = placeInCalendar(
      [b("scheduled", "2026-10-07T16:00:00.000Z", "2026-10-07T16:30:00.000Z"), b("scheduled", "2026-10-07T15:00:00.000Z", "2026-10-07T15:30:00.000Z")],
      CR,
      "week",
      { range: { from: "2026-10-05", to: "2026-10-11" } },
    );
    expect(Object.keys(r.byDate)).toHaveLength(7);
    expect(r.byDate["2026-10-05"]).toEqual([]);
    expect(r.byDate["2026-10-07"].map((i) => i.startMinutes)).toEqual([540, 600]);
  });
});
