import { describe, expect, it } from "vitest";
import { calendarConnectionStatus, canCreateEventsWith, isUserBookable } from "./bookable";

const EVENTS = "https://www.googleapis.com/auth/calendar.events";
const FREEBUSY = "https://www.googleapis.com/auth/calendar.events.freebusy";

describe("estado de una conexion (F7)", () => {
  it("con todos los permisos y activa: connected", () => {
    expect(calendarConnectionStatus({ id: "c", status: "active", granted_scopes: [EVENTS, FREEBUSY] })).toBe("connected");
  });
  it("sin el permiso de eventos: attention (sirve solo para conflictos)", () => {
    const c = { id: "c", status: "active" as const, granted_scopes: [FREEBUSY] };
    expect(calendarConnectionStatus(c)).toBe("attention");
    expect(canCreateEventsWith(c)).toBe(false);
  });
  it("revoked y error se muestran tal cual", () => {
    expect(calendarConnectionStatus({ id: "c", status: "revoked", granted_scopes: [EVENTS] })).toBe("revoked");
    expect(calendarConnectionStatus({ id: "c", status: "error", granted_scopes: [EVENTS] })).toBe("error");
  });
});

describe("isUserBookable (F7)", () => {
  const profile = { is_active: true };
  const cal = (id: string, connection_id: string, check_conflicts: boolean, is_active = true) => ({ id, connection_id, check_conflicts, is_active });

  it("una conexion revocada con calendarios de conflicto frena con calendar_disconnected", () => {
    expect(
      isUserBookable({
        profile,
        connections: [{ id: "c1", status: "revoked", granted_scopes: [] }],
        calendars: [cal("k1", "c1", true)],
      }),
    ).toEqual({ ok: false, reason: "calendar_disconnected" });
  });

  it("una conexion revocada sin calendarios de conflicto ni destino en uso no frena", () => {
    expect(
      isUserBookable({
        profile,
        connections: [{ id: "c1", status: "revoked", granted_scopes: [] }, { id: "c2", status: "active", granted_scopes: [] }],
        calendars: [cal("k1", "c1", false), cal("k2", "c2", true)],
        defaultDestinationCalendarId: "k2",
      }),
    ).toEqual({ ok: true });
  });

  it("frena si el destino por defecto o un calendario usado por un evento es de la conexion caida", () => {
    const connections = [{ id: "c1", status: "error" as const, granted_scopes: [] }];
    expect(isUserBookable({ profile, connections, calendars: [cal("k1", "c1", false)], defaultDestinationCalendarId: "k1" })).toEqual({ ok: false, reason: "calendar_disconnected" });
    expect(isUserBookable({ profile, connections, calendars: [cal("k1", "c1", false)], calendarIdsInUse: ["k1"] })).toEqual({ ok: false, reason: "calendar_disconnected" });
    // Un calendario inactivo de la conexion caida no cuenta.
    expect(isUserBookable({ profile, connections, calendars: [cal("k1", "c1", true, false)] })).toEqual({ ok: true });
  });

  it("sin perfil o con el perfil inactivo, no", () => {
    expect(isUserBookable({ profile: null, connections: [], calendars: [] })).toEqual({ ok: false, reason: "no_profile" });
    expect(isUserBookable({ profile: { is_active: false }, connections: [], calendars: [] })).toEqual({ ok: false, reason: "profile_inactive" });
  });
});
