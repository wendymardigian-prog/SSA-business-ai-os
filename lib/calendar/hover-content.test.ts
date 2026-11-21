import { describe, expect, it } from "vitest";
import { bookingHover, busyHover, googleHover, googleWhen } from "./hover-content";
import type { AgendaGoogleEvent } from "@/lib/google-calendar/agenda";

const TZ = "America/Costa_Rica";
const ev: AgendaGoogleEvent = {
  id: "g1", calendarId: "c1", calendarName: "Personal", calendarColor: "#9fe1e7", accessRole: "owner", externalEventId: "e1",
  recurringEventId: "r1", etag: null, status: "confirmed", summary: "Reunión de equipo con un título largo", description: null,
  location: null, htmlLink: null, meetUrl: "https://meet.google.com/x", organizerEmail: "otra@ejemplo.com", organizerSelf: false,
  attendees: [
    { email: "yo@ejemplo.com", name: null, response: "accepted", self: true, organizer: false, optional: false, resource: false },
    { email: "a@ejemplo.com", name: "Ana", response: "accepted", self: false, organizer: false, optional: false, resource: false },
    { email: "b@ejemplo.com", name: null, response: "accepted", self: false, organizer: false, optional: false, resource: false },
    { email: "c@ejemplo.com", name: "Caro", response: "accepted", self: false, organizer: false, optional: false, resource: false },
    { email: "d@ejemplo.com", name: "Dani", response: "accepted", self: false, organizer: false, optional: false, resource: false },
  ],
  selfResponse: "accepted", guestsCanModify: false, startAt: "2026-11-17T15:00:00.000Z", endAt: "2026-11-17T16:00:00.000Z",
  allDay: false, startDate: null, endDate: null, timeZone: null, transparency: "transparent", eventType: "default", bookingId: null,
};

describe("tarjeta al pasar el mouse", () => {
  it("un evento de Google: nombre completo, horario en mi zona, calendario, organizador, invitados y que no está en el sistema", () => {
    const h = googleHover(ev, TZ, "24h");
    expect(h.title).toBe("Reunión de equipo con un título largo");
    expect(h.lines[0]).toBe("Martes, 17 de noviembre · 09:00 a 10:00");
    expect(h.lines).toContain("Google Calendar · Personal");
    expect(h.lines).toContain("Organiza: otra@ejemplo.com");
    expect(h.lines).toContain("Invitados: Ana, b@ejemplo.com, Caro y 1 más");
    expect(h.lines).toContain("Se repite");
    expect(h.lines).toContain("Disponible: no bloquea horarios");
    expect(h.lines.at(-1)).toBe("Solo en Google: no está en el sistema");
  });

  it("un evento de todo el día de varios días", () => {
    expect(googleWhen({ allDay: true, startDate: "2026-11-28", endDate: "2026-12-01", startAt: "", endAt: "" }, TZ, "24h")).toBe(
      "Sábado, 28 de noviembre al Lunes, 30 de noviembre · Todo el día",
    );
  });

  it("una reunión: contacto, horario, estado y quién atiende", () => {
    const h = bookingHover(
      { title: "Llamada de diagnóstico", startAt: "2026-11-17T15:00:00.000Z", endAt: "2026-11-17T15:30:00.000Z", status: "scheduled", contactName: "Marco", bookerName: null, meetUrl: null, locationText: "Oficina", slotReleasedAt: null },
      "Ignacio",
      TZ,
      "24h",
    );
    expect(h.title).toBe("Marco");
    expect(h.lines).toEqual(expect.arrayContaining(["Martes, 17 de noviembre · 09:00 a 09:30", "Llamada de diagnóstico", "Atiende: Ignacio", "Oficina"]));
  });

  it("el ocupado de otra persona no tiene detalle", () => {
    const h = busyHover({ key: "k", userId: "u", startAt: ev.startAt, endAt: ev.endAt, allDay: false, startDate: null, endDate: null }, "Ana", TZ, "24h");
    expect(h.title).toBe("Ocupado · Ana");
    expect(h.lines).toHaveLength(2);
  });
});
