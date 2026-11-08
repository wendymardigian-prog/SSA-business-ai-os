// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { liveDateIssues, liveSessionIssues, liveSessionPayload, liveSessionSummary, type LiveSessionInput } from "./live-sessions";

const weekly: LiveSessionInput = {
  title: "Clase en vivo",
  kind: "weekly",
  weekdays: [4, 2, 2],
  everyWeeks: 1,
  startsOn: "2026-11-02",
  startTime: "19:00",
  durationMinutes: 60,
  timezone: "America/Costa_Rica",
};

describe("liveSessionIssues", () => {
  it("una semanal completa no tiene problemas", () => {
    expect(liveSessionIssues(weekly)).toEqual([]);
  });
  it("pide título, días, frecuencia, fecha y hora", () => {
    const issues = liveSessionIssues({ ...weekly, title: " ", weekdays: [], everyWeeks: 5, startsOn: "", startTime: "25:00" });
    expect(issues).toEqual(["Escribí el título", "Elegí al menos un día", "La frecuencia va de cada 1 a cada 4 semanas", "Elegí desde qué día", "Elegí la hora"]);
  });
  it("el último día no puede ser antes del primero", () => {
    expect(liveSessionIssues({ ...weekly, endsOn: "2026-11-01" })).toContain("El último día no puede ser antes del primero");
  });
  it("una suelta pide día y hora", () => {
    expect(liveSessionIssues({ title: "Q&A", kind: "single", durationMinutes: 45, timezone: "UTC" })).toEqual(["Elegí el día y la hora"]);
    expect(liveSessionIssues({ title: "Q&A", kind: "single", singleLocal: "2026-11-20T19:00", durationMinutes: 45, timezone: "UTC" })).toEqual([]);
  });
  it("duración, link, variantes y base", () => {
    const issues = liveSessionIssues({ ...weekly, durationMinutes: 2, meetingUrl: "http://x", variantIds: [], attendanceBase: { type: "started_within", days: 0 } as never });
    expect(issues).toEqual([
      "La duración va de 5 minutos a 12 horas",
      "El link de la reunión empieza con https://",
      "Elegí al menos una variante, o «todas»",
      "Los días van de 1 a 365",
    ]);
  });
});

describe("liveSessionPayload", () => {
  it("una semanal ordena y saca los días repetidos, sin fecha suelta", () => {
    const p = liveSessionPayload({ ...weekly, meetingUrl: "  https://meet.example/abc " }, () => "nunca");
    expect(p).toMatchObject({ kind: "weekly", weekdays: [2, 4], every_weeks: 1, single_at: null, start_time: "19:00", meeting_url: "https://meet.example/abc", track_clicks: true, click_counts_as_attendance: false, attendance_base: { type: "active" } });
  });
  it("una suelta pasa la hora a UTC y no guarda días", () => {
    const p = liveSessionPayload({ title: "Q&A", kind: "single", singleLocal: "2026-11-20T19:00", durationMinutes: 45, timezone: "America/Costa_Rica" }, (l, tz) => `${l}@${tz}`);
    expect(p).toMatchObject({ weekdays: null, every_weeks: null, starts_on: null, start_time: null, single_at: "2026-11-20T19:00@America/Costa_Rica" });
  });
});

describe("liveSessionSummary", () => {
  it("semanal", () => {
    expect(liveSessionSummary({ kind: "weekly", weekdays: [2, 4], every_weeks: 1, start_time: "19:00:00", timezone: "UTC", single_at: null }, String)).toBe("Martes y jueves 19:00 (UTC), cada semana");
    expect(liveSessionSummary({ kind: "weekly", weekdays: [1, 3, 5], every_weeks: 2, start_time: "08:30", timezone: "UTC", single_at: null }, String)).toBe("Lunes, miércoles y viernes 08:30 (UTC), cada 2 semanas");
  });
  it("suelta", () => {
    expect(liveSessionSummary({ kind: "single", weekdays: null, every_weeks: null, start_time: null, timezone: "UTC", single_at: "x" }, (s) => `F(${s})`)).toBe("F(x) (UTC)");
  });
});

describe("liveDateIssues", () => {
  it("mover pide la fecha nueva y la grabación es https", () => {
    expect(liveDateIssues({ status: "moved" })).toEqual(["Elegí el día y la hora nuevos"]);
    expect(liveDateIssues({ status: "cancelled", recordingUrl: "ftp://x" })).toEqual(["El link de la grabación empieza con https://"]);
    expect(liveDateIssues({ status: "moved", movedToLocal: "2026-11-21T19:00", recordingUrl: "https://x.example/r" })).toEqual([]);
  });
});
