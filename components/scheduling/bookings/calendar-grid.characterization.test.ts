/**
 * Caracterizacion del calendario de agendas: fija el HTML que dibuja en dia, semana y mes con las props basicas. Las
 * demas (tareas, arrastre) son opcionales: sin ellas, nada de esto puede cambiar.
 *
 * Actualizada a proposito el 10/11/2026 (mejoras de UX de Agenda): la tarjeta muestra el circulo de quien atiende
 * (foto o iniciales) en vez del icono de Meet, y el estado va como chip de color en vez de texto suelto.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import { placeInCalendar } from "@/lib/scheduling/calendar-view";
import { BookingsCalendar } from "./calendar-grid";

const item = (over: Partial<BookingListItem> & { id: string; startAt: string; endAt: string }): BookingListItem => ({
  uid: `uid-${over.id}`, title: "Llamada", status: "scheduled", hostUserId: "h1", hostName: "Ana", contactId: "c1", contactName: "Beto Perez", bookerName: null,
  bookerEmail: null, bookerPhone: null, eventTypeId: "e1", eventColor: "#2563eb", categorySnapshot: null as never, origin: "public", locationType: null,
  locationText: null, meetUrl: null, timezone: null, syncStatus: "synced", slotReleasedAt: null, createdAt: "2026-01-01T00:00:00Z", attribution: {}, ...over,
});

// 2026-10-14 (miercoles) 15:00 UTC = 09:00 en Costa Rica.
const ITEMS: BookingListItem[] = [
  item({ id: "b1", startAt: "2026-10-14T15:00:00Z", endAt: "2026-10-14T15:30:00Z", meetUrl: "https://meet.google.com/abc-defg-hij" }),
  item({ id: "b2", startAt: "2026-10-14T20:00:00Z", endAt: "2026-10-14T21:00:00Z", contactName: "Carla", status: "confirmed", eventColor: null }),
  item({ id: "b3", startAt: "2026-10-16T16:00:00Z", endAt: "2026-10-16T16:45:00Z", contactName: null, bookerName: "Diego" }),
  item({ id: "b4", startAt: "2026-10-15T16:00:00Z", endAt: "2026-10-15T16:30:00Z", status: "cancelled_other" }),
];

const html = (view: "day" | "week" | "month", anchor = "2026-10-14") =>
  renderToStaticMarkup(
    createElement(BookingsCalendar, { items: ITEMS, hostNames: { h1: "Ana Gomez" }, timezone: "America/Costa_Rica", timeFormat: "24h", view, anchor, onView: () => undefined, onAnchor: () => undefined, onOpen: () => undefined }),
  );

describe("BookingsCalendar sin tareas ni arrastre: lo que dibuja hoy (caracterizacion)", () => {
  it("semana", () => {
    const out = html("week");
    expect(out).toMatchSnapshot();
    expect(out).toContain("Semana del 12 de octubre al 18 de octubre");
    expect(out).toContain("Beto Perez");
    expect(out).not.toContain("draggable");
  });
  it("dia", () => {
    const out = html("day");
    expect(out).toMatchSnapshot();
    expect(out).toContain("Carla");
  });
  it("mes", () => {
    const out = html("month");
    expect(out).toMatchSnapshot();
    expect(out).toContain("Diego");
  });
  it("las canceladas no se dibujan", () => {
    expect(html("week")).not.toContain("uid-b4");
    const placement = placeInCalendar(ITEMS.map((i) => ({ ...i, start_at: i.startAt, end_at: i.endAt, event_color: i.eventColor })), "America/Costa_Rica", "week", { range: { from: "2026-10-12", to: "2026-10-18" } });
    expect(placement.items.map((i) => i.booking.id)).toEqual(["b1", "b2", "b3"]);
    expect(Object.keys(placement.byDate)).toHaveLength(7);
  });
  it("en lugar del icono de Meet, la tarjeta muestra el circulo de quien atiende (sus iniciales sin foto)", () => {
    for (const view of ["day", "week", "month"] as const) {
      const out = html(view);
      expect(out).toContain("Anfitrión: Ana Gomez");
      expect(out).toContain(">AG<");
      expect(out).not.toContain("Unirse a Meet");
    }
  });
  it("el estado va como chip de color en las tarjetas con lugar (dia y semana) y como punto en el mes", () => {
    const week = html("week");
    expect(week).toContain("bg-green-500/12"); // Confirmada (b2, de una hora)
    expect(week).toContain(">Confirmada<");
    const month = html("month");
    expect(month).not.toContain(">Confirmada<");
    expect(month).toContain("bg-green-500");
  });
  it("una tarjeta baja (30 min) no apila el chip: lo cambia por un punto de color", () => {
    // Solo la rejilla de escritorio: la lista del celular (que va en el mismo HTML) si tiene lugar para el chip.
    const desktop = html("week").split('<ul class="divide-y divide-border md:hidden">')[0];
    // b1 dura 30 minutos (26 px): su estado "Agendada" va solo como tooltip y punto.
    expect(desktop).toContain('title="Agendada"');
    expect(desktop).not.toContain(">Agendada<");
  });
  it("no tiene ningun interruptor de tareas", () => {
    const out = html("week");
    expect(out).not.toContain("Tareas");
    expect(out).toContain("Las canceladas no se muestran");
  });
});
