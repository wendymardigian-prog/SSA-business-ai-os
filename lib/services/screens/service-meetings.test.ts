import { describe, expect, it } from "vitest";
import { recentMeetings, serviceMeetings, type MeetingBooking, type MeetingCall } from "./service-meetings";

const NOW = new Date("2026-11-12T18:00:00Z");
const WINDOW = { createdAt: "2026-11-01T00:00:00Z", endsOn: "2027-01-31" };

const booking = (id: string, over: Partial<MeetingBooking> = {}): MeetingBooking => ({
  id,
  startAt: "2026-11-10T15:00:00Z",
  endAt: "2026-11-10T15:30:00Z",
  status: "scheduled",
  title: "Seguimiento",
  hostUserId: "u-host",
  areaKey: "servicio",
  typeKey: "servicio.seguimiento",
  typeLabel: "Seguimiento",
  itemOfThisService: false,
  ...over,
});
const call = (id: string, over: Partial<MeetingCall> = {}): MeetingCall => ({
  id,
  bookingId: null,
  recordedAt: "2026-11-10T15:00:00Z",
  title: "Llamada",
  recorderUserId: "u-rec",
  typeLabel: "Seguimiento",
  noShow: false,
  analysisStatus: "pending",
  score: null,
  serviceLink: "auto",
  pendingProposals: 0,
  ...over,
});

describe("serviceMeetings", () => {
  it("una agenda con su grabación da UNA fila", () => {
    const rows = serviceMeetings({ calls: [call("c1", { bookingId: "b1" })], bookings: [booking("b1")], window: WINDOW, now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ callId: "c1", bookingId: "b1", state: "recorded" });
  });
  it("una agenda pasada sin grabación da «Sin grabación»; una futura, «Agendada»", () => {
    const rows = serviceMeetings({
      calls: [],
      bookings: [booking("b1"), booking("b2", { startAt: "2026-11-20T15:00:00Z", endAt: "2026-11-20T15:30:00Z" })],
      window: WINDOW,
      now: NOW,
    });
    expect(rows.map((r) => [r.bookingId, r.state])).toEqual([["b2", "scheduled"], ["b1", "missing_recording"]]);
  });
  it("una marcada «no se presentó» da «No se presentó»", () => {
    expect(serviceMeetings({ calls: [], bookings: [booking("b1", { status: "no_show" })], window: WINDOW, now: NOW })[0].state).toBe("no_show");
    expect(serviceMeetings({ calls: [call("c1", { noShow: true })], bookings: [], window: WINDOW, now: NOW })[0].state).toBe("no_show");
  });
  it("una grabación sin agenda da una fila «Grabada»; analizada lleva la nota", () => {
    const rows = serviceMeetings({ calls: [call("c1"), call("c2", { analysisStatus: "analyzed", score: 82, recordedAt: "2026-11-11T10:00:00Z" })], bookings: [], window: WINDOW, now: NOW });
    expect(rows.map((r) => [r.callId, r.state, r.score])).toEqual([["c2", "analyzed", 82], ["c1", "recorded", null]]);
  });
  it("el orden es de la más nueva a la más vieja", () => {
    const rows = serviceMeetings({
      calls: [call("viejo", { recordedAt: "2026-11-02T10:00:00Z" })],
      bookings: [booking("nuevo", { startAt: "2026-11-11T10:00:00Z", endAt: "2026-11-11T10:30:00Z" })],
      window: WINDOW,
      now: NOW,
    });
    expect(rows.map((r) => r.key)).toEqual(["booking:nuevo", "call:viejo"]);
  });
  it("Clase, otras áreas, fuera de período y canceladas no entran (salvo el paso de este servicio)", () => {
    const rows = serviceMeetings({
      calls: [],
      bookings: [
        booking("clase", { typeKey: "servicio.clase" }),
        booking("venta", { areaKey: "ventas", typeKey: "ventas.cierre" }),
        booking("antes", { startAt: "2026-10-01T10:00:00Z", endAt: "2026-10-01T10:30:00Z" }),
        booking("paso", { startAt: "2026-10-01T10:00:00Z", endAt: "2026-10-01T10:30:00Z", areaKey: "ventas", typeKey: null, itemOfThisService: true }),
        booking("cancelada", { status: "cancelled_by_host" }),
      ],
      window: WINDOW,
      now: NOW,
    });
    expect(rows.map((r) => r.bookingId)).toEqual(["paso"]);
    expect(serviceMeetings({ calls: [], bookings: [booking("cancelada", { status: "cancelled_by_host" })], window: WINDOW, now: NOW, showCancelled: true })[0].state).toBe("cancelled");
  });
  it("marca «Por revisar» y las propuestas pendientes", () => {
    const [r] = serviceMeetings({ calls: [call("c1", { serviceLink: "review", pendingProposals: 2 })], bookings: [], window: WINDOW, now: NOW });
    expect(r).toMatchObject({ review: true, pendingProposals: 2 });
  });
  it("muestra las 10 más recientes y avisa si hay más", () => {
    const many = Array.from({ length: 12 }, (_, i) => call(`c${i}`, { recordedAt: `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00Z` }));
    const out = recentMeetings(serviceMeetings({ calls: many, bookings: [], window: WINDOW, now: NOW }));
    expect(out.rows).toHaveLength(10);
    expect(out.more).toBe(true);
  });
});
