// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import occ from "./occurrences.cases.json";
import win from "./attendance-window.cases.json";
import base from "./attendance-base.cases.json";
import { attendanceBaseIssues, attendancePct, inAttendanceBase, inAttendanceWindow, occurrences, type AttendanceBase, type LiveDateException, type LiveSessionShape } from "./occurrences";

describe("las fechas de una sesión (casos compartidos con la base)", () => {
  for (const c of occ.cases) it(c.name, () => expect(occurrences(c.session as LiveSessionShape, c.exceptions as LiveDateException[], c.from, c.to)).toEqual(c.expected));
  it("hay al menos 10 casos", () => expect(occ.cases.length).toBeGreaterThanOrEqual(10));
});
describe("la ventana de asistencia (casos compartidos con la base)", () => {
  for (const c of win.cases) it(c.name, () => expect(inAttendanceWindow(c.startsAt, c.endsAt, c.at)).toBe(c.expected));
});
describe("sobre quiénes se mide (casos compartidos con la base)", () => {
  for (const c of base.cases) it(c.name, () => expect(inAttendanceBase(c.base as AttendanceBase, c.sessionVariantIds, c.member, c.occursOn)).toBe(c.expected));
  it("hay al menos 8 casos", () => expect(base.cases.length).toBeGreaterThanOrEqual(8));
});
describe("el promedio", () => {
  it("cuenta solo a los de la base; base vacía es «—»", () => {
    expect(attendancePct(["a", "b", "c", "d"], ["a", "b", "x"])).toBe(50);
    expect(attendancePct([], ["a"])).toBeNull();
  });
  it("la forma de la base", () => {
    expect(attendanceBaseIssues({ type: "active" })).toEqual([]);
    expect(attendanceBaseIssues({ type: "started_within", days: 0 })).toEqual(["los días van de 1 a 365"]);
    expect(attendanceBaseIssues({ type: "otro" })).toEqual(["elegí sobre quiénes se mide"]);
  });
});
