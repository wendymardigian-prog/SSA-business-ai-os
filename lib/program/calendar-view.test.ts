// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import {
  attendanceCell,
  attendanceRate,
  baseLabel,
  calendarKpis,
  dateKey,
  monthGrid,
  pctLabel,
  seriesStats,
  sessionRowView,
  shiftMonth,
  studentRate,
  type OverviewDate,
} from "./calendar-view";

const hhmm = (iso: string) => iso.slice(11, 16);

function day(over: Partial<OverviewDate>): OverviewDate {
  return { live_session_id: "s1", occurs_on: "2026-11-03", starts_at: "2026-11-04T01:00:00Z", ends_at: "2026-11-04T02:00:00Z", status: "normal", base: [], attended: [], clicks: [], ...over };
}

describe("attendanceCell: los 5 estados", () => {
  const d = day({
    base: ["a", "b", "c", "d"],
    attended: [
      { id: "1", contact_id: "a", source: "self", added_manually: false },
      { id: "2", contact_id: "b", source: "team", added_manually: false },
      { id: "3", contact_id: "z", source: "click", added_manually: false },
    ],
    clicks: [{ contact_id: "c", clicked_at: "2026-11-04T01:05:00Z" }, { contact_id: "c", clicked_at: "2026-11-04T01:02:00Z" }],
  });
  it("asistió él, asistió (equipo), hizo clic con la primera hora, no asistió y sin acceso", () => {
    expect(attendanceCell(d, "a", hhmm)).toEqual({ state: "self", label: "Asistió" });
    expect(attendanceCell(d, "b", hhmm)).toEqual({ state: "team", label: "Asistió (equipo)" });
    expect(attendanceCell(d, "c", hhmm)).toMatchObject({ state: "clicked", label: "Hizo clic 01:02" });
    expect(attendanceCell(d, "d", hhmm)).toEqual({ state: "absent", label: "No asistió" });
    expect(attendanceCell(d, "x", hhmm)).toEqual({ state: "no_access", label: "·" });
  });
  it("un clic que cuenta como asistencia es «Asistió», aunque esté fuera de la base", () => {
    expect(attendanceCell(d, "z", hhmm)).toEqual({ state: "self", label: "Asistió" });
  });
});

describe("sessionRowView", () => {
  it("«19 de 24 · 2 clics sin confirmar · Sin grabación»", () => {
    const base = Array.from({ length: 24 }, (_, i) => `p${i}`);
    const attended = base.slice(0, 19).map((c, i) => ({ id: String(i), contact_id: c, source: "self" as const, added_manually: false }));
    const clicks = [{ contact_id: "p20", clicked_at: "x" }, { contact_id: "p20", clicked_at: "y" }, { contact_id: "p21", clicked_at: "z" }, { contact_id: "p0", clicked_at: "w" }];
    expect(sessionRowView(day({ base, attended, clicks }), null)).toBe("19 de 24 · 2 clics sin confirmar · Sin grabación");
  });
  it("con grabación y sin clics", () => {
    expect(sessionRowView(day({ base: ["a"] }), { recording_url: "https://x", recording_call_id: null, recording_active: true })).toBe("0 de 1 · Con grabación");
  });
});

describe("la métrica solo mira la base", () => {
  it("agregar a alguien fuera de la base no cambia el promedio", () => {
    const before = day({ base: ["a", "b"], attended: [{ id: "1", contact_id: "a", source: "self", added_manually: false }] });
    const after = day({ ...before, attended: [...before.attended, { id: "2", contact_id: "out", source: "team", added_manually: true }] });
    expect(attendanceRate([before])).toBe(50);
    expect(attendanceRate([after])).toBe(50);
    expect(sessionRowView(after, null)).toBe("1 de 2 · Sin grabación");
  });
  it("una base vacía es «—» y no 0 %", () => {
    expect(attendanceRate([day({ base: [] })])).toBeNull();
    expect(pctLabel(null)).toBe("—");
    expect(pctLabel(0)).toBe("0 %");
  });
  it("el % de un estudiante solo cuenta las fechas en las que tenía acceso", () => {
    const d1 = day({ occurs_on: "2026-11-03", base: ["a"], attended: [{ id: "1", contact_id: "a", source: "self", added_manually: false }] });
    const d2 = day({ occurs_on: "2026-11-10", base: ["b"] });
    const d3 = day({ occurs_on: "2026-11-17", base: ["a"] });
    expect(studentRate([d1, d2, d3], "a")).toBe(50);
    expect(studentRate([d2], "a")).toBeNull();
  });
});

describe("KPIs, series y mes", () => {
  it("calendarKpis", () => {
    const d1 = day({ occurs_on: "2026-11-03", base: ["a"], clicks: [{ contact_id: "a", clicked_at: "t" }] });
    const d2 = day({ occurs_on: "2026-11-10", base: ["a"], attended: [{ id: "1", contact_id: "a", source: "self", added_manually: false }] });
    const recs = new Map([[dateKey("s1", "2026-11-10"), { recording_url: "https://x", recording_call_id: null, recording_active: true }]]);
    const k = calendarKpis([d1, d2], recs, [
      { live_session_id: "s1", starts_at: "2026-11-25T01:00:00Z", status: "cancelled" },
      { live_session_id: "s2", starts_at: "2026-11-26T01:00:00Z", status: "normal" },
    ]);
    expect(k).toEqual({ rate: 50, withoutRecording: 1, unconfirmedClicks: 1, next: { live_session_id: "s2", starts_at: "2026-11-26T01:00:00Z" } });
  });
  it("seriesStats toma las últimas 6 fechas de la serie", () => {
    const dates = Array.from({ length: 8 }, (_, i) => day({ occurs_on: `2026-10-${String(i + 1).padStart(2, "0")}`, base: ["a"], attended: i % 2 ? [{ id: String(i), contact_id: "a", source: "self", added_manually: false }] : [] }));
    const s = seriesStats("s1", [...dates, day({ live_session_id: "otra", base: ["a"] })]);
    expect(s.bars.map((b) => b.occursOn)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(s.rate).toBe(50);
  });
  it("monthGrid arranca el lunes y completa las semanas", () => {
    const g = monthGrid(2026, 11);
    expect(g[0][0]).toEqual({ date: "2026-10-26", inMonth: false });
    expect(g[0][6]).toEqual({ date: "2026-11-01", inMonth: true });
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[g.length - 1].some((d) => d.date === "2026-11-30")).toBe(true);
    expect(monthGrid(2027, 2).length).toBe(4);
  });
  it("shiftMonth", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("baseLabel", () => {
    expect(baseLabel({ type: "active" })).toBe("Todos con acceso al calendario");
    expect(baseLabel({ type: "started_within", days: 30 })).toBe("Quienes empezaron hace 30 días o menos");
    expect(baseLabel({ type: "phase", phase_key: "ph_abc123" }, { phase: "Arranque" })).toBe("Quienes están en la fase «Arranque»");
  });
});
