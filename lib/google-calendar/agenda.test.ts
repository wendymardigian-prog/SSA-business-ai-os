import { describe, expect, it } from "vitest";
import {
  canEditGoogleEvent,
  descriptionToText,
  googleTitle,
  parseGoogleLayer,
  placeGoogleInCalendar,
  shiftSeries,
  suggestedContact,
  visibleInAgenda,
  type AgendaGoogleEvent,
} from "./agenda";

const base: AgendaGoogleEvent = {
  id: "g1", calendarId: "c1", calendarName: "Yo", calendarColor: null, accessRole: "owner", externalEventId: "e1",
  recurringEventId: null, etag: null, status: "confirmed", summary: "Dentista", description: null, location: null,
  htmlLink: null, meetUrl: null, organizerEmail: "yo@x.com", organizerSelf: true, attendees: [], selfResponse: "accepted",
  guestsCanModify: false, startAt: "2026-11-24T15:00:00.000Z", endAt: "2026-11-24T16:00:00.000Z", allDay: false,
  startDate: null, endDate: null, timeZone: null, transparency: "opaque", eventType: "default", bookingId: null,
};
const RANGE = { from: "2026-11-23", to: "2026-11-29" };

describe("capa Google de la Agenda", () => {
  it("el interruptor está prendido salvo google=0", () => {
    expect(parseGoogleLayer(undefined)).toBe(true);
    expect(parseGoogleLayer("0")).toBe(false);
  });

  it("no muestra lo de una reunión, lo rechazado ni la ubicación de trabajo", () => {
    expect(visibleInAgenda(base)).toBe(true);
    expect(visibleInAgenda({ ...base, bookingId: "b1" })).toBe(false);
    expect(visibleInAgenda({ ...base, selfResponse: "declined" })).toBe(false);
    expect(visibleInAgenda({ ...base, eventType: "workingLocation" })).toBe(false);
  });

  it("solo se edita lo que organizo, en un calendario donde puedo escribir", () => {
    expect(canEditGoogleEvent(base)).toBe(true);
    expect(canEditGoogleEvent({ ...base, organizerSelf: false })).toBe(false);
    expect(canEditGoogleEvent({ ...base, accessRole: "reader" })).toBe(false);
    expect(canEditGoogleEvent({ ...base, eventType: "birthday" })).toBe(false);
  });

  it("ubica un evento con hora en la zona de quien mira", () => {
    const p = placeGoogleInCalendar({ events: [base], busy: [], viewerTz: "America/Costa_Rica", view: "week", range: RANGE });
    const item = p.byDate["2026-11-24"][0];
    expect(item.timed && item.startMinutes).toBe(9 * 60);
  });

  it("uno de todo el día de varios días aparece en cada día del rango", () => {
    const ev = { ...base, allDay: true, startDate: "2026-11-28", endDate: "2026-12-02" };
    const p = placeGoogleInCalendar({ events: [ev], busy: [], viewerTz: "UTC", view: "week", range: RANGE });
    expect(p.byDate["2026-11-28"]).toHaveLength(1);
    expect(p.byDate["2026-11-29"]).toHaveLength(1);
    expect(p.byDate["2026-11-27"]).toHaveLength(0);
  });

  it("el ocupado de otra persona no tiene título", () => {
    const busy = { key: "k", userId: "u2", startAt: base.startAt, endAt: base.endAt, allDay: false, startDate: null, endDate: null };
    const p = placeGoogleInCalendar({ events: [], busy: [busy], viewerTz: "UTC", view: "week", range: RANGE });
    expect(googleTitle(p.byDate["2026-11-24"][0], "Ana")).toBe("Ocupado · Ana");
  });

  it("toda la serie se corre lo mismo que la instancia", () => {
    expect(
      shiftSeries({
        masterStartUtc: "2026-11-02T15:00:00.000Z",
        instanceStartUtc: "2026-11-24T15:00:00.000Z",
        newInstanceStartUtc: "2026-11-24T16:30:00.000Z",
        newDurationMinutes: 45,
      }),
    ).toEqual({ startUtc: "2026-11-02T16:30:00.000Z", endUtc: "2026-11-02T17:15:00.000Z" });
  });

  it("sugiere como contacto al primer invitado que no soy yo ni una sala", () => {
    const ev = {
      ...base,
      attendees: [
        { email: "yo@x.com", name: null, response: "accepted", self: true, organizer: true, optional: false, resource: false },
        { email: "sala@x.com", name: "Sala", response: "accepted", self: false, organizer: false, optional: false, resource: true },
        { email: "ana@ejemplo.com", name: "Ana", response: "needsAction", self: false, organizer: false, optional: false, resource: false },
      ],
    };
    expect(suggestedContact(ev)).toEqual({ email: "ana@ejemplo.com", name: "Ana" });
    expect(suggestedContact({ ...base, organizerSelf: false, organizerEmail: "otro@ejemplo.com" })).toEqual({ email: "otro@ejemplo.com", name: null });
  });

  it("la descripción se muestra como texto, nunca como HTML", () => {
    expect(descriptionToText('Hola<br>mundo <a href="https://x.com">link</a><script>alert(1)</script>')).toBe("Hola\nmundo link (https://x.com)alert(1)");
    expect(descriptionToText("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
  });
});
