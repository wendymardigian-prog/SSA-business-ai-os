import { describe, expect, it } from "vitest";
import { meetingDayRange, meetingPeople, MATCH_LABELS, sanitizeTerm, suggestBookings } from "./booking-suggestions";

const a = (id: string, extra = {}) => ({ id, start_at: null, email: null, full_name: null, ...extra });

describe("meetingPeople", () => {
  it("excluye al anfitrion y al equipo; toma voces sin correo (entraron por link)", () => {
    const r = meetingPeople(
      [{ email: "closer@x.io", name: "Closer", is_external: false }, { email: "Lead@Gmail.com", name: "Lead Uno", is_external: true }],
      [{ speaker: { display_name: "Closer", matched_calendar_invitee_email: "closer@x.io" } }, { speaker: { display_name: "María Pérez" } }, { speaker: { display_name: "Ana Equipo" } }],
      "closer@x.io", ["Ana Equipo"],
    );
    expect(r.emails).toEqual(["lead@gmail.com"]);
    expect(r.names).toEqual(["Lead Uno", "María Pérez"]);
  });
  it("sin datos: vacio", () => {
    expect(meetingPeople(null, null, null)).toEqual({ emails: [], names: [] });
  });
});

describe("meetingDayRange", () => {
  it("una llamada a las 20:00 en Costa Rica cae en el dia completo de Costa Rica", () => {
    expect(meetingDayRange("2026-09-26T02:00:00Z", "America/Costa_Rica")).toEqual({
      from: "2026-09-25T06:00:00.000Z",
      to: "2026-09-26T05:59:59.999Z",
    });
  });
});

describe("suggestBookings", () => {
  it("ordena correo > nombre > fecha, sin repetir, con el motivo", () => {
    const r = suggestBookings([a("1", { email: "x@y.com" })], [a("1"), a("2", { full_name: "Ana" })], [a("2"), a("3")]);
    expect(r.map((x) => [x.id, x.match])).toEqual([["1", "email"], ["2", "nombre"], ["3", "fecha"]]);
    expect(r[0].reason).toContain("x@y.com");
    expect(r[1].reason).toContain("Ana");
    expect(r[2].reason).toContain("mismo día");
  });
  it("respeta el limite", () => {
    expect(suggestBookings([a("1"), a("2"), a("3")], [], [], 2)).toHaveLength(2);
  });
  it("las etiquetas de cada coincidencia", () => {
    expect(MATCH_LABELS.email).toBe("Coincide por correo");
  });
  it("sanitizeTerm saca los caracteres de los filtros", () => {
    expect(sanitizeTerm("Ana (C.), x*")).toBe("Ana C x");
  });
});
