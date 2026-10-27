/**
 * Caracterizacion del calendario de agendas: fija el HTML que dibuja en dia, semana y mes con las props basicas. Las
 * demas (tareas, arrastre) son opcionales: sin ellas, nada de esto puede cambiar.
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
  locationText: null, meetUrl: null, timezone: null, syncStatus: "synced", slotReleasedAt: null, ...over,
});

// 2026-10-14 (miercoles) 15:00 UTC = 09:00 en Costa Rica.
const ITEMS: BookingListItem[] = [
  item({ id: "b1", startAt: "2026-10-14T15:00:00Z", endAt: "2026-10-14T15:30:00Z" }),
  item({ id: "b2", startAt: "2026-10-14T20:00:00Z", endAt: "2026-10-14T21:00:00Z", contactName: "Carla", status: "confirmed", eventColor: null }),
  item({ id: "b3", startAt: "2026-10-16T16:00:00Z", endAt: "2026-10-16T16:45:00Z", contactName: null, bookerName: "Diego" }),
  item({ id: "b4", startAt: "2026-10-15T16:00:00Z", endAt: "2026-10-15T16:30:00Z", status: "cancelled_other" }),
];

const html = (view: "day" | "week" | "month", anchor = "2026-10-14") =>
  renderToStaticMarkup(
    createElement(BookingsCalendar, { items: ITEMS, timezone: "America/Costa_Rica", timeFormat: "24h", view, anchor, onView: () => undefined, onAnchor: () => undefined, onOpen: () => undefined }),
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
  it("no tiene ningun interruptor de tareas", () => {
    const out = html("week");
    expect(out).not.toContain("Tareas");
    expect(out).toContain("Las canceladas no se muestran");
  });
});
