import { describe, it, expect } from "vitest";
import { getAvailableSlots, availableSlots, isSlotAvailable, type SlotsInput } from "./index";
import { countBookings } from "../limits/counts";
import type { TimeRange, WeeklyHours } from "../types";

const CR = "America/Costa_Rica"; // UTC-6 todo el año
const NY = "America/New_York";

const R = (start: string, end: string): TimeRange => ({ start, end });
const weekdays = (ranges: TimeRange[]): WeeklyHours => ({
  "1": ranges,
  "2": ranges,
  "3": ranges,
  "4": ranges,
  "5": ranges,
});

/** Evento base: 30 min, sin buffers, sin aviso, 60 días corridos, sin topes. */
const baseEvent: SlotsInput["eventType"] = {
  duration_minutes: 30,
  slot_interval_minutes: null,
  before_buffer_minutes: 0,
  after_buffer_minutes: 0,
  minimum_notice_minutes: 0,
  period_type: "rolling_calendar",
  period_days: 60,
  period_start_date: null,
  period_end_date: null,
  max_per_day: null,
  max_per_week: null,
};

function input(partial: Partial<SlotsInput> & { weekly?: WeeklyHours; tz?: string }): SlotsInput {
  const tz = partial.tz ?? CR;
  return {
    eventType: baseEvent,
    schedule: { timezone: tz, weekly_hours: partial.weekly ?? weekdays([R("09:00", "17:00")]), date_overrides: [] },
    now: "2026-10-04T12:00:00.000Z", // domingo 4/10/2026
    range: { from: "2026-10-05T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z" }, // semana del lunes 5/10
    inviteeTz: tz,
    ...partial,
  };
}

const starts = (slots: { startUtc: string }[] | undefined) => (slots ?? []).map((s) => s.startUtc);

describe("motor de horarios (F23): los 8 casos del plano", () => {
  it("1. lunes 9:00–12:00 en Costa Rica, 30 min, intervalo = duración → 6 horarios de 9:00 a 11:30", () => {
    const out = getAvailableSlots(input({ weekly: { "1": [R("09:00", "12:00")] } }));
    expect(Object.keys(out)).toEqual(["2026-10-05"]);
    expect(starts(out["2026-10-05"])).toEqual([
      "2026-10-05T15:00:00.000Z",
      "2026-10-05T15:30:00.000Z",
      "2026-10-05T16:00:00.000Z",
      "2026-10-05T16:30:00.000Z",
      "2026-10-05T17:00:00.000Z",
      "2026-10-05T17:30:00.000Z",
    ]);
    expect(out["2026-10-05"][0].endUtc).toBe("2026-10-05T15:30:00.000Z");
  });

  it("2. agenda existente 10:00–10:30 con 15 min de buffer después; evento nuevo sin buffers e intervalo 15 → no 10:30, sí 10:45", () => {
    const out = getAvailableSlots(
      input({
        weekly: { "1": [R("09:00", "12:00")] },
        eventType: { ...baseEvent, slot_interval_minutes: 15 },
        bookings: [
          { start_at: "2026-10-05T16:00:00.000Z", end_at: "2026-10-05T16:30:00.000Z", before_buffer_minutes: 0, after_buffer_minutes: 15 },
        ],
      }),
    );
    const lunes = starts(out["2026-10-05"]);
    expect(lunes).not.toContain("2026-10-05T16:30:00.000Z"); // 10:30 local
    expect(lunes).toContain("2026-10-05T16:45:00.000Z"); // 10:45 local
    // Tampoco 9:45 (terminaría 10:15, encima de la agenda) ni 10:00.
    expect(lunes).not.toContain("2026-10-05T15:45:00.000Z");
    expect(lunes).not.toContain("2026-10-05T16:00:00.000Z");
    expect(lunes).toContain("2026-10-05T15:30:00.000Z");
  });

  it("3. lunes a viernes 9–17 en New York: el primer horario cambia de 14:00Z a 13:00Z en marzo y vuelve en noviembre", () => {
    const marzo = getAvailableSlots(
      input({
        tz: NY,
        now: "2026-03-01T12:00:00.000Z",
        range: { from: "2026-03-06T00:00:00.000Z", to: "2026-03-10T00:00:00.000Z" },
      }),
    );
    expect(marzo["2026-03-06"][0].startUtc).toBe("2026-03-06T14:00:00.000Z"); // viernes 6/3, EST
    expect(marzo["2026-03-09"][0].startUtc).toBe("2026-03-09T13:00:00.000Z"); // lunes 9/3, EDT

    const noviembre = getAvailableSlots(
      input({
        tz: NY,
        now: "2026-10-25T12:00:00.000Z",
        range: { from: "2026-10-30T00:00:00.000Z", to: "2026-11-03T00:00:00.000Z" },
      }),
    );
    expect(noviembre["2026-10-30"][0].startUtc).toBe("2026-10-30T13:00:00.000Z"); // viernes 30/10, EDT
    expect(noviembre["2026-11-02"][0].startUtc).toBe("2026-11-02T14:00:00.000Z"); // lunes 2/11, EST
    // Y el día completo sigue teniendo 16 horarios de 30 min a cada lado del cambio.
    expect(marzo["2026-03-09"]).toHaveLength(16);
    expect(noviembre["2026-11-02"]).toHaveLength(16);
  });

  it("4. invitado en Tokio con horario 18:00–20:00 de Costa Rica: se agrupa en el día siguiente", () => {
    const out = getAvailableSlots(
      input({
        weekly: { "1": [R("18:00", "20:00")] },
        inviteeTz: "Asia/Tokyo",
      }),
    );
    // Lunes 5/10 18:00 CR = 6/10 00:00Z = martes 6/10 09:00 en Tokio.
    expect(Object.keys(out)).toEqual(["2026-10-06"]);
    expect(starts(out["2026-10-06"])).toEqual([
      "2026-10-06T00:00:00.000Z",
      "2026-10-06T00:30:00.000Z",
      "2026-10-06T01:00:00.000Z",
      "2026-10-06T01:30:00.000Z",
    ]);
  });

  it("5. aviso mínimo de 2 h con now = martes 6/10 10:10 hora de Costa Rica → el primer horario del día es 12:30 local (18:30Z)", () => {
    const out = getAvailableSlots(
      input({
        eventType: { ...baseEvent, minimum_notice_minutes: 120, slot_interval_minutes: 30 },
        now: "2026-10-06T16:10:00.000Z",
        range: { from: "2026-10-06T06:00:00.000Z", to: "2026-10-07T06:00:00.000Z" },
      }),
    );
    expect(out["2026-10-06"][0].startUtc).toBe("2026-10-06T18:30:00.000Z");
    // Y sigue de 30 en 30 hasta las 16:30 local.
    expect(out["2026-10-06"].at(-1)?.startUtc).toBe("2026-10-06T22:30:00.000Z");
  });

  it("6. tope de 2 por día con 2 agendas ese día → ese día no ofrece horarios, los otros sí", () => {
    const bookings = [
      { start_at: "2026-10-06T15:00:00.000Z", end_at: "2026-10-06T15:30:00.000Z" },
      { start_at: "2026-10-06T20:00:00.000Z", end_at: "2026-10-06T20:30:00.000Z" },
    ];
    const out = getAvailableSlots(
      input({
        eventType: { ...baseEvent, max_per_day: 2 },
        bookings,
        bookingCounts: countBookings(bookings, CR),
      }),
    );
    expect(out["2026-10-06"]).toBeUndefined();
    expect(out["2026-10-05"]).toHaveLength(16);
    expect(out["2026-10-07"]).toHaveLength(16);
  });

  it("7. excepción 'no disponible' el miércoles → vacío; excepción 14:00–15:00 el jueves → solo ese rango", () => {
    const out = getAvailableSlots(
      input({
        overrides: [
          { date: "2026-10-07", ranges: [] },
          { date: "2026-10-08", ranges: [R("14:00", "15:00")] },
        ],
      }),
    );
    expect(out["2026-10-07"]).toBeUndefined();
    expect(starts(out["2026-10-08"])).toEqual(["2026-10-08T20:00:00.000Z", "2026-10-08T20:30:00.000Z"]);
    expect(out["2026-10-09"]).toHaveLength(16); // el viernes sigue normal
  });

  it("8. tiempo fuera del 20/12 al 31/12 → esos días vacíos", () => {
    const out = getAvailableSlots(
      input({
        now: "2026-12-13T12:00:00.000Z",
        range: { from: "2026-12-14T06:00:00.000Z", to: "2027-01-05T06:00:00.000Z" },
        eventType: { ...baseEvent, period_type: "unlimited" },
        outOfOffice: [{ starts_at: "2026-12-20T06:00:00.000Z", ends_at: "2027-01-01T06:00:00.000Z" }],
      }),
    );
    const dias = Object.keys(out);
    expect(dias).toContain("2026-12-18"); // viernes antes
    expect(dias.filter((d) => d >= "2026-12-20" && d <= "2026-12-31")).toEqual([]);
    expect(dias).toContain("2027-01-01"); // viernes 1/1: el tiempo fuera termina a las 00:00 local
    expect(dias).toContain("2027-01-04");
  });
});

describe("motor de horarios: otros casos", () => {
  it("F15: la vista previa usa el motor con busy = []", () => {
    const out = getAvailableSlots(input({ busy: [] }));
    expect(Object.keys(out)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });

  it("el ocupado de Google se resta, agrandado con los buffers del evento nuevo", () => {
    const out = getAvailableSlots(
      input({
        weekly: { "1": [R("09:00", "12:00")] },
        eventType: { ...baseEvent, before_buffer_minutes: 15, after_buffer_minutes: 15 },
        busy: [{ startUtc: "2026-10-05T16:00:00.000Z", endUtc: "2026-10-05T16:30:00.000Z" }], // 10:00–10:30
      }),
    );
    // Libre: 9:00–9:45 y 10:45–12:00. Con 30 min e intervalo 30 alineado: 9:00 y 11:00, 11:30.
    expect(starts(out["2026-10-05"])).toEqual([
      "2026-10-05T15:00:00.000Z",
      "2026-10-05T17:00:00.000Z",
      "2026-10-05T17:30:00.000Z",
    ]);
  });

  it("una agenda del sistema bloquea con sus buffers y los del evento nuevo a la vez", () => {
    const slots = availableSlots(
      input({
        weekly: { "1": [R("09:00", "12:00")] },
        eventType: { ...baseEvent, after_buffer_minutes: 10, slot_interval_minutes: 5 },
        bookings: [{ start_at: "2026-10-05T16:00:00.000Z", end_at: "2026-10-05T16:30:00.000Z", before_buffer_minutes: 5, after_buffer_minutes: 0 }],
      }),
    );
    const s = starts(slots);
    // El nuevo termina + 10 min tiene que estar antes de 10:00 - 5 min = 9:55 → último inicio 9:15.
    expect(s).toContain("2026-10-05T15:15:00.000Z");
    expect(s).not.toContain("2026-10-05T15:20:00.000Z");
    // Después: desde 10:30 (la agenda no tiene buffer después y el nuevo no tiene antes).
    expect(s).toContain("2026-10-05T16:30:00.000Z");
  });

  it("descarta los horarios que no entran completos en la ventana", () => {
    const out = getAvailableSlots(
      input({ weekly: { "1": [R("09:00", "10:20")] }, eventType: { ...baseEvent, duration_minutes: 30 } }),
    );
    expect(starts(out["2026-10-05"])).toEqual(["2026-10-05T15:00:00.000Z", "2026-10-05T15:30:00.000Z"]);
  });

  it("los horarios se recortan al rango pedido y nunca al pasado", () => {
    const out = getAvailableSlots(
      input({
        now: "2026-10-05T16:05:00.000Z", // lunes 10:05 local
        range: { from: "2026-10-05T06:00:00.000Z", to: "2026-10-05T18:00:00.000Z" }, // hasta las 12:00 local
      }),
    );
    expect(starts(out["2026-10-05"])).toEqual(["2026-10-05T16:30:00.000Z", "2026-10-05T17:00:00.000Z", "2026-10-05T17:30:00.000Z"]);
  });

  it("ignoreMinimumNotice (F37) saltea el aviso pero no el pasado", () => {
    const base = input({
      eventType: { ...baseEvent, minimum_notice_minutes: 120 },
      now: "2026-10-06T16:10:00.000Z",
      range: { from: "2026-10-06T06:00:00.000Z", to: "2026-10-07T06:00:00.000Z" },
    });
    expect(getAvailableSlots(base)["2026-10-06"][0].startUtc).toBe("2026-10-06T18:30:00.000Z");
    expect(getAvailableSlots({ ...base, ignoreMinimumNotice: true })["2026-10-06"][0].startUtc).toBe("2026-10-06T16:30:00.000Z");
  });

  it("la ventana futura corta los días de más y el tope semanal se aplica", () => {
    const corto = getAvailableSlots(input({ eventType: { ...baseEvent, period_days: 2 } })); // hasta el martes 6/10
    expect(Object.keys(corto)).toEqual(["2026-10-05", "2026-10-06"]);

    const bookings = Array.from({ length: 3 }, (_, i) => ({
      start_at: `2026-10-0${5 + i}T15:00:00.000Z`,
      end_at: `2026-10-0${5 + i}T15:30:00.000Z`,
    }));
    const semana = getAvailableSlots(
      input({ eventType: { ...baseEvent, max_per_week: 3 }, bookings, bookingCounts: countBookings(bookings, CR) }),
    );
    expect(Object.keys(semana)).toEqual([]);
  });

  it("isSlotAvailable: el servidor decide si el horario pedido es exactamente uno del motor", () => {
    const i = input({ weekly: { "1": [R("09:00", "12:00")] } });
    expect(isSlotAvailable(i, "2026-10-05T15:30:00.000Z")).toBe(true);
    expect(isSlotAvailable(i, "2026-10-05T15:40:00.000Z")).toBe(false);
    expect(isSlotAvailable(i, "2026-10-05T18:00:00.000Z")).toBe(false);
  });

  it("horario que pasa la medianoche: 20:00–24:00 más 00:00–02:00 del día siguiente es una sola ventana", () => {
    const out = getAvailableSlots(
      input({
        weekly: { "1": [R("20:00", "24:00")], "2": [R("00:00", "02:00")] },
        eventType: { ...baseEvent, duration_minutes: 60, slot_interval_minutes: 30 },
        range: { from: "2026-10-05T06:00:00.000Z", to: "2026-10-07T06:00:00.000Z" },
      }),
    );
    const todos = [...(out["2026-10-05"] ?? []), ...(out["2026-10-06"] ?? [])].map((s) => s.startUtc);
    // 23:30 local termina 00:30 del martes: solo entra si las dos ventanas son una.
    expect(todos).toContain("2026-10-06T05:30:00.000Z");
    expect(todos).toHaveLength(11); // 20:00, 20:30, … 01:00 local
  });
});
