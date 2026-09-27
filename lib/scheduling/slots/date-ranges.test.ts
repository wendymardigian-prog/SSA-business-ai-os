// Casos adaptados de `packages/features/schedules/lib/date-ranges.test.ts` de Cal.diy (MIT), sobre nuestro modelo jsonb.
import { describe, it, expect } from "vitest";
import { dailyWindows, subtractRanges, mergeOverlapping, intersectRanges, clipRanges, rangesForDate } from "./date-ranges";
import { busyRanges } from "./busy";

const at = (iso: string) => Date.parse(iso);
const r = (a: string, b: string) => ({ start: at(a), end: at(b) });
const iso = (ranges: { start: number; end: number }[]) =>
  ranges.map((x) => [new Date(x.start).toISOString(), new Date(x.end).toISOString()]);

describe("dailyWindows", () => {
  const schedule = {
    timezone: "America/New_York",
    weekly_hours: { "1": [{ start: "09:00", end: "17:00" }], "2": [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] },
    date_overrides: [],
  };

  it("arma las ventanas en UTC según la zona del horario", () => {
    expect(iso(dailyWindows(schedule, "2026-10-05", "2026-10-06"))).toEqual([
      ["2026-10-05T13:00:00.000Z", "2026-10-05T21:00:00.000Z"],
      ["2026-10-06T13:00:00.000Z", "2026-10-06T16:00:00.000Z"],
      ["2026-10-06T17:00:00.000Z", "2026-10-06T21:00:00.000Z"],
    ]);
  });

  it("tiene horario correcto el día del cambio de horario de verano (menos y más horas)", () => {
    // Domingo 8/3/2026 (empieza DST) y domingo 1/11/2026 (termina).
    const s = { ...schedule, weekly_hours: { "0": [{ start: "00:00", end: "24:00" }] } };
    const marzo = dailyWindows(s, "2026-03-08", "2026-03-08");
    expect(iso(marzo)).toEqual([["2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]]); // 23 horas
    const noviembre = dailyWindows(s, "2026-11-01", "2026-11-01");
    expect(iso(noviembre)).toEqual([["2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"]]); // 25 horas
  });

  it("una excepción de día completo no disponible deja el día vacío", () => {
    const s = { ...schedule, date_overrides: [{ date: "2026-10-05", ranges: [] }] };
    expect(dailyWindows(s, "2026-10-05", "2026-10-05")).toEqual([]);
    expect(rangesForDate(s, "2026-10-05")).toEqual([]);
  });

  it("una excepción con rango reemplaza la regla semanal del día, no se suma", () => {
    const s = { ...schedule, date_overrides: [{ date: "2026-10-05", ranges: [{ start: "14:00", end: "15:00" }] }] };
    expect(iso(dailyWindows(s, "2026-10-05", "2026-10-05"))).toEqual([["2026-10-05T18:00:00.000Z", "2026-10-05T19:00:00.000Z"]]);
  });

  it("una excepción en un día que no trabaja abre ese día (sábado puntual)", () => {
    const s = { ...schedule, date_overrides: [{ date: "2026-10-10", ranges: [{ start: "10:00", end: "12:00" }] }] };
    expect(iso(dailyWindows(s, "2026-10-10", "2026-10-10"))).toEqual([["2026-10-10T14:00:00.000Z", "2026-10-10T16:00:00.000Z"]]);
  });

  it("el parámetro overrides reemplaza los del horario", () => {
    const s = { ...schedule, date_overrides: [{ date: "2026-10-05", ranges: [] }] };
    expect(dailyWindows(s, "2026-10-05", "2026-10-05", [])).toHaveLength(1);
  });

  it("disponibilidad pasada la medianoche se fusiona en una ventana continua", () => {
    const s = { ...schedule, weekly_hours: { "1": [{ start: "20:00", end: "24:00" }], "2": [{ start: "00:00", end: "02:00" }] } };
    expect(iso(dailyWindows(s, "2026-10-05", "2026-10-06"))).toEqual([["2026-10-06T00:00:00.000Z", "2026-10-06T06:00:00.000Z"]]);
  });
});

describe("subtractRanges (portado)", () => {
  const source = [r("2026-10-05T09:00:00Z", "2026-10-05T17:00:00Z")];

  it("resta cuando los excluidos vienen en orden", () => {
    const out = subtractRanges(source, [r("2026-10-05T10:00:00Z", "2026-10-05T11:00:00Z"), r("2026-10-05T14:00:00Z", "2026-10-05T15:00:00Z")]);
    expect(iso(out)).toEqual([
      ["2026-10-05T09:00:00.000Z", "2026-10-05T10:00:00.000Z"],
      ["2026-10-05T11:00:00.000Z", "2026-10-05T14:00:00.000Z"],
      ["2026-10-05T15:00:00.000Z", "2026-10-05T17:00:00.000Z"],
    ]);
  });

  it("resta igual cuando los excluidos vienen desordenados o se pasan del borde", () => {
    const out = subtractRanges(source, [r("2026-10-05T16:30:00Z", "2026-10-05T18:00:00Z"), r("2026-10-05T08:00:00Z", "2026-10-05T09:30:00Z")]);
    expect(iso(out)).toEqual([["2026-10-05T09:30:00.000Z", "2026-10-05T16:30:00.000Z"]]);
  });

  it("no extiende los rangos en lugar de excluir (bug de offset de Cal.diy)", () => {
    const out = subtractRanges(source, [r("2026-10-05T09:00:00Z", "2026-10-05T17:00:00Z")]);
    expect(out).toEqual([]);
  });
});

describe("mergeOverlapping / clipRanges / intersectRanges", () => {
  it("une los que se superponen o se tocan y ordena", () => {
    const out = mergeOverlapping([
      r("2026-10-05T14:00:00Z", "2026-10-05T15:00:00Z"),
      r("2026-10-05T09:00:00Z", "2026-10-05T12:00:00Z"),
      r("2026-10-05T12:00:00Z", "2026-10-05T13:00:00Z"),
      r("2026-10-05T11:00:00Z", "2026-10-05T12:30:00Z"),
    ]);
    expect(iso(out)).toEqual([
      ["2026-10-05T09:00:00.000Z", "2026-10-05T13:00:00.000Z"],
      ["2026-10-05T14:00:00.000Z", "2026-10-05T15:00:00.000Z"],
    ]);
    expect(mergeOverlapping([])).toEqual([]);
  });

  it("recorta al rango pedido", () => {
    expect(iso(clipRanges([r("2026-10-05T09:00:00Z", "2026-10-05T17:00:00Z")], at("2026-10-05T10:00:00Z"), at("2026-10-05T12:00:00Z")))).toEqual([
      ["2026-10-05T10:00:00.000Z", "2026-10-05T12:00:00.000Z"],
    ]);
  });

  it("intersección: vacío, una lista, sin superposición, que se tocan, contención", () => {
    const a = [r("2026-10-05T09:00:00Z", "2026-10-05T12:00:00Z")];
    const b = [r("2026-10-05T11:00:00Z", "2026-10-05T14:00:00Z")];
    expect(intersectRanges([])).toEqual([]);
    expect(intersectRanges([a])).toEqual(a);
    expect(intersectRanges([a, [r("2026-10-05T12:00:00Z", "2026-10-05T13:00:00Z")]])).toEqual([]);
    expect(iso(intersectRanges([a, b]))).toEqual([["2026-10-05T11:00:00.000Z", "2026-10-05T12:00:00.000Z"]]);
    expect(iso(intersectRanges([a, [r("2026-10-05T10:00:00Z", "2026-10-05T11:00:00Z")]]))).toEqual([["2026-10-05T10:00:00.000Z", "2026-10-05T11:00:00.000Z"]]);
  });
});

describe("busyRanges", () => {
  it("Google se agranda con los buffers del evento nuevo; el sistema con los de ambos; el tiempo fuera no", () => {
    const out = busyRanges({
      outOfOffice: [{ starts_at: "2026-10-05T00:00:00.000Z", ends_at: "2026-10-05T01:00:00.000Z" }],
      busy: [{ startUtc: "2026-10-05T10:00:00.000Z", endUtc: "2026-10-05T10:30:00.000Z" }],
      bookings: [{ start_at: "2026-10-05T14:00:00.000Z", end_at: "2026-10-05T14:30:00.000Z", before_buffer_minutes: 5, after_buffer_minutes: 15 }],
      newBeforeMinutes: 10,
      newAfterMinutes: 20,
    });
    expect(iso(out)).toEqual([
      ["2026-10-05T00:00:00.000Z", "2026-10-05T01:00:00.000Z"],
      ["2026-10-05T09:40:00.000Z", "2026-10-05T10:40:00.000Z"],
      ["2026-10-05T13:35:00.000Z", "2026-10-05T14:55:00.000Z"],
    ]);
  });

  it("ignora intervalos inválidos y devuelve vacío sin entradas", () => {
    expect(busyRanges({ newBeforeMinutes: 0, newAfterMinutes: 0 })).toEqual([]);
    expect(busyRanges({ busy: [{ startUtc: "x", endUtc: "y" }], newBeforeMinutes: 0, newAfterMinutes: 0 })).toEqual([]);
  });
});
