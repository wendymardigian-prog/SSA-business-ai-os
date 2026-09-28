import { describe, expect, it } from "vitest";
import { bookingPageState, inviteeActions, cancelledByText } from "./booking-page";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const bk = (over: Partial<Parameters<typeof inviteeActions>[0]> = {}) => ({
  status: "scheduled" as const,
  start_at: "2026-10-01T15:00:00.000Z",
  end_at: "2026-10-01T15:30:00.000Z",
  cancelled_at: null,
  cancelled_by_type: null,
  cancellation_reason: null,
  ...over,
});

describe("bookingPageState", () => {
  it("una agenda futura y activa esta por venir", () => {
    expect(bookingPageState(bk(), NOW)).toBe("upcoming");
    expect(bookingPageState(bk({ status: "confirmed" }), NOW)).toBe("upcoming");
    expect(bookingPageState(bk({ status: "rescheduled" }), NOW)).toBe("upcoming");
  });

  it("empezada cuando ya paso la hora de inicio", () => {
    expect(bookingPageState(bk({ start_at: "2026-10-01T11:59:00.000Z" }), NOW)).toBe("started");
  });

  it("cancelada por cualquiera de los tres motivos", () => {
    for (const status of ["cancelled_other", "cancelled_no_response", "cancelled_not_qualified"] as const) {
      expect(bookingPageState(bk({ status }), NOW)).toBe("cancelled");
    }
  });

  it("no-show y los resultados ya pasaron", () => {
    expect(bookingPageState(bk({ status: "no_show" }), NOW)).toBe("past");
    expect(bookingPageState(bk({ status: "sale" }), NOW)).toBe("past");
    expect(bookingPageState(bk({ status: "followup_warm" }), NOW)).toBe("past");
  });
});

describe("inviteeActions", () => {
  it("por venir: cancela, reagenda y agrega al calendario", () => {
    expect(inviteeActions(bk(), NOW)).toEqual({ state: "upcoming", canCancel: true, canReschedule: true, canAddToCalendar: true, reason: null });
  });

  it("empezada: no cancela ni reagenda, pero todavia se agrega al calendario", () => {
    const a = inviteeActions(bk({ start_at: "2026-10-01T11:45:00.000Z", end_at: "2026-10-01T12:15:00.000Z" }), NOW);
    expect(a).toMatchObject({ state: "started", canCancel: false, canReschedule: false, canAddToCalendar: true });
    expect(a.reason).toBe("Esta reunión ya empezó.");
  });

  it("terminada: nada", () => {
    const a = inviteeActions(bk({ start_at: "2026-10-01T10:00:00.000Z", end_at: "2026-10-01T10:30:00.000Z" }), NOW);
    expect(a).toMatchObject({ canCancel: false, canReschedule: false, canAddToCalendar: false });
    expect(a.reason).toBe("Esta reunión ya pasó.");
  });

  it("cancelada: no se reagenda (cancelar es final)", () => {
    const a = inviteeActions(bk({ status: "cancelled_other" }), NOW);
    expect(a).toMatchObject({ state: "cancelled", canCancel: false, canReschedule: false });
  });

  it("justo en la hora de inicio ya no se toca", () => {
    expect(inviteeActions(bk(), new Date("2026-10-01T15:00:00.000Z")).canCancel).toBe(false);
  });
});

describe("cancelledByText", () => {
  it("dice quien cancelo", () => {
    expect(cancelledByText({ cancelled_by_type: "invitee" }, "Wendy")).toBe("La cancelaste vos.");
    expect(cancelledByText({ cancelled_by_type: "host" }, "Wendy")).toBe("La canceló Wendy.");
    expect(cancelledByText({ cancelled_by_type: "system" }, "Wendy")).toBe("La canceló el sistema.");
    expect(cancelledByText({ cancelled_by_type: null }, "Wendy")).toBe("Está cancelada.");
  });
});
