import { describe, expect, it } from "vitest";
import { canCreateMeet, meetAvailableFor, type MeetContext } from "./meet-availability";

const EVENTS = "https://www.googleapis.com/auth/calendar.events";

function ctx(over: Partial<MeetContext> = {}): MeetContext {
  return {
    calendars: [
      { id: "cal-1", user_id: "u1", connection_id: "con-1", name: "Principal", access_role: "owner", check_conflicts: true, is_active: true },
      { id: "cal-ro", user_id: "u1", connection_id: "con-1", name: "Feriados", access_role: "reader", check_conflicts: false, is_active: true },
    ],
    connections: [{ id: "con-1", user_id: "u1", status: "active", granted_scopes: [EVENTS] }],
    defaultDestinationByUser: new Map([["u1", "cal-1"]]),
    ...over,
  };
}

describe("meetAvailableFor", () => {
  it("con destino, cuenta activa y permiso de eventos: si", () => {
    expect(meetAvailableFor(ctx(), "u1")).toBe(true);
  });

  it("una persona sin Google: no", () => {
    expect(meetAvailableFor(ctx(), "u2")).toBe(false);
  });

  it("sin calendario destino en el perfil: no", () => {
    expect(meetAvailableFor(ctx({ defaultDestinationByUser: new Map() }), "u1")).toBe(false);
  });

  it("la cuenta rota (revocada o con error): no", () => {
    for (const status of ["revoked", "error"] as const) {
      expect(meetAvailableFor(ctx({ connections: [{ id: "con-1", user_id: "u1", status, granted_scopes: [EVENTS] }] }), "u1")).toBe(false);
    }
  });

  it("sin el permiso para crear eventos: no", () => {
    expect(meetAvailableFor(ctx({ connections: [{ id: "con-1", user_id: "u1", status: "active", granted_scopes: [] }] }), "u1")).toBe(false);
  });

  it("el destino propio del evento gana al del perfil", () => {
    expect(meetAvailableFor(ctx(), "u1", "cal-ro")).toBe(false);
    expect(meetAvailableFor(ctx({ defaultDestinationByUser: new Map() }), "u1", "cal-1")).toBe(true);
  });

  it("un calendario inactivo no sirve de destino", () => {
    const calendars = ctx().calendars.map((c) => ({ ...c, is_active: false }));
    expect(meetAvailableFor(ctx({ calendars }), "u1")).toBe(false);
  });
});

describe("canCreateMeet", () => {
  it("sin destino o sin cuenta: no", () => {
    expect(canCreateMeet(null, { id: "c", status: "active", granted_scopes: [EVENTS] })).toBe(false);
    expect(canCreateMeet({ id: "x", name: "x", access_role: "writer", check_conflicts: false, is_active: true }, null)).toBe(false);
  });
});
