import { describe, expect, it } from "vitest";
import { parseGoogleEvent } from "./client";
import { mirrorFullSyncFrom, selfResponse, toMirrorRow } from "./mirror";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const CAL = { id: "cal-1", workspace_id: "ws-1", user_id: "user-1", connection_id: "conn-1" };
const ev = (raw: Record<string, unknown>) => parseGoogleEvent({ id: "e1", ...raw })!;

describe("la copia de la Agenda (00510)", () => {
  it("guarda un evento con hora, con sus datos", () => {
    const d = toMirrorRow(ev({ summary: "Café", start: { dateTime: "2026-11-21T10:00:00Z" }, end: { dateTime: "2026-11-21T11:00:00Z" } }), CAL, NOW);
    expect(d.kind).toBe("upsert");
    if (d.kind !== "upsert") return;
    expect(d.row).toMatchObject({ calendar_id: "cal-1", user_id: "user-1", external_event_id: "e1", summary: "Café", all_day: false, start_at: "2026-11-21T10:00:00.000Z" });
  });

  it("uno de todo el día guarda la fecha civil y la medianoche UTC", () => {
    const d = toMirrorRow(ev({ start: { date: "2026-11-22" }, end: { date: "2026-11-23" } }), CAL, NOW);
    expect(d.kind === "upsert" && d.row).toMatchObject({ all_day: true, start_date: "2026-11-22", end_date: "2026-11-23", start_at: "2026-11-22T00:00:00.000Z" });
  });

  it("cancelado, sin hora o fuera de la ventana se borra", () => {
    expect(toMirrorRow(ev({ status: "cancelled" }), CAL, NOW)).toEqual({ kind: "delete", reason: "cancelled" });
    expect(toMirrorRow(ev({}), CAL, NOW)).toEqual({ kind: "delete", reason: "no_time" });
    expect(toMirrorRow(ev({ start: { dateTime: "2026-08-01T10:00:00Z" }, end: { dateTime: "2026-08-01T11:00:00Z" } }), CAL, NOW)).toEqual({ kind: "delete", reason: "out_of_window" });
    expect(toMirrorRow(ev({ start: { dateTime: "2028-01-01T10:00:00Z" }, end: { dateTime: "2028-01-01T11:00:00Z" } }), CAL, NOW)).toEqual({ kind: "delete", reason: "out_of_window" });
  });

  it("reconoce la reunión de la plataforma por su uid", () => {
    const d = toMirrorRow(ev({ start: { dateTime: "2026-11-21T10:00:00Z" }, end: { dateTime: "2026-11-21T11:00:00Z" }, extendedProperties: { private: { bookingUid: "uid-9" } } }), CAL, NOW);
    expect(d.kind === "upsert" && d.bookingUid).toBe("uid-9");
  });

  it("mi respuesta: la de mi invitación, o aceptada si lo organicé", () => {
    expect(selfResponse(ev({ attendees: [{ email: "yo@x.com", self: true, responseStatus: "declined" }] }))).toBe("declined");
    expect(selfResponse(ev({ organizer: { email: "yo@x.com", self: true } }))).toBe("accepted");
    expect(selfResponse(ev({}))).toBeNull();
  });

  it("la primera lectura es de 60 días atrás", () => {
    expect(mirrorFullSyncFrom(NOW)).toBe("2026-09-21T12:00:00.000Z");
  });
});
