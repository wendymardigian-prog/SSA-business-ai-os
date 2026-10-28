import { describe, expect, it } from "vitest";
import { planManualBooking } from "./manual-input";

const base = {
  title: "Reunión con Ana",
  date: "2026-11-03",
  time: "10:30",
  durationMinutes: 30,
  timezone: "America/Argentina/Buenos_Aires",
  name: "Ana",
  email: "Ana@Ejemplo.com",
};

describe("planManualBooking", () => {
  it("un titulo libre, un invitado nuevo y el horario en la zona de quien agenda", () => {
    const r = planManualBooking(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.startUtc).toBe("2026-11-03T13:30:00.000Z");
    expect(r.plan.endUtc).toBe("2026-11-03T14:00:00.000Z");
    expect(r.plan.email).toBe("ana@ejemplo.com");
    expect(r.plan.eventTypeId).toBeNull();
  });

  it("con un evento elegido el titulo puede quedar vacio, y no se usan anfitrion ni area", () => {
    const r = planManualBooking({ ...base, title: "", eventTypeId: "ev-1", hostUserId: "u-2", categoryId: "cat" });
    expect(r.ok && r.plan.hostUserId).toBeNull();
    expect(r.ok && r.plan.categoryId).toBeNull();
  });

  it("sin evento y sin titulo pide el titulo", () => {
    expect(planManualBooking({ ...base, title: " " })).toMatchObject({ ok: false, field: "title" });
  });

  it("con un contacto elegido no pide nombre ni email", () => {
    const r = planManualBooking({ ...base, contactId: "c-1", name: "", email: "" });
    expect(r.ok).toBe(true);
    expect(r.ok && r.plan.email).toBeNull();
  });

  it("sin contacto pide nombre y un email valido", () => {
    expect(planManualBooking({ ...base, name: "" })).toMatchObject({ ok: false, field: "name" });
    expect(planManualBooking({ ...base, email: "" })).toMatchObject({ ok: false, field: "email" });
    expect(planManualBooking({ ...base, email: "ana@" })).toMatchObject({ ok: false, field: "email" });
  });

  it("valida el dia, la hora y la duracion", () => {
    expect(planManualBooking({ ...base, date: "2026-02-30" })).toMatchObject({ ok: false, field: "date" });
    expect(planManualBooking({ ...base, time: "25:00" })).toMatchObject({ ok: false, field: "time" });
    expect(planManualBooking({ ...base, durationMinutes: 0 })).toMatchObject({ ok: false, field: "duration" });
    expect(planManualBooking({ ...base, durationMinutes: 13 * 60 })).toMatchObject({ ok: false, field: "duration" });
  });

  it("las notas tienen tope", () => {
    expect(planManualBooking({ ...base, notes: "x".repeat(2001) })).toMatchObject({ ok: false, field: "notes" });
  });
});
