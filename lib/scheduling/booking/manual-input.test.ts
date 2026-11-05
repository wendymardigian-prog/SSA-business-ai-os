import { describe, expect, it } from "vitest";
import { initialInviteeTimezone, planManualBooking } from "./manual-input";

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

  it("la ubicacion: Meet, texto recortado, vacio = a confirmar, y sin elegir = la del evento", () => {
    const meet = planManualBooking({ ...base, location: { kind: "google_meet" } });
    expect(meet.ok && meet.plan.location).toEqual({ kind: "google_meet" });
    const text = planManualBooking({ ...base, location: { kind: "text", text: "  Oficina central  " } });
    expect(text.ok && text.plan.location).toEqual({ kind: "text", text: "Oficina central" });
    const empty = planManualBooking({ ...base, location: { kind: "text", text: "   " } });
    expect(empty.ok && empty.plan.location).toEqual({ kind: "text", text: null });
    const none = planManualBooking(base);
    expect(none.ok && none.plan.location).toBeNull();
  });

  it("la ubicacion tiene tope", () => {
    expect(planManualBooking({ ...base, location: { kind: "text", text: "x".repeat(501) } })).toMatchObject({ ok: false, field: "location" });
  });

  it("la hora se lee en la zona de quien agenda y la del invitado viaja aparte", () => {
    const r = planManualBooking({ ...base, inviteeTimezone: "America/Mexico_City", inviteeTimezoneChosen: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 10:30 en Buenos Aires, aunque el invitado este en Mexico.
    expect(r.plan.startUtc).toBe("2026-11-03T13:30:00.000Z");
    expect(r.plan.timezone).toBe("America/Argentina/Buenos_Aires");
    expect(r.plan.inviteeTimezone).toBe("America/Mexico_City");
    expect(r.plan.inviteeTimezoneChosen).toBe(true);
  });

  it("sin zona del invitado usa la de quien agenda, y no cuenta como elegida", () => {
    const r = planManualBooking(base);
    expect(r.ok && r.plan.inviteeTimezone).toBe("America/Argentina/Buenos_Aires");
    expect(r.ok && r.plan.inviteeTimezoneChosen).toBe(false);
  });

  it("rechaza una zona que no existe", () => {
    expect(planManualBooking({ ...base, inviteeTimezone: "Marte/Olympus" })).toMatchObject({ ok: false, field: "timezone" });
    expect(planManualBooking({ ...base, timezone: "Marte/Olympus" })).toMatchObject({ ok: false, field: "time" });
  });
});

describe("initialInviteeTimezone", () => {
  const viewerTimezone = "America/Argentina/Buenos_Aires";

  it("gana la guardada en el contacto", () => {
    expect(initialInviteeTimezone({ contactTimezone: "Europe/Madrid", phone: "+52 55 1234 5678", viewerTimezone })).toEqual({
      timezone: "Europe/Madrid",
      source: "contact",
    });
  });

  it("sin zona guardada, la deduce del telefono", () => {
    expect(initialInviteeTimezone({ contactTimezone: null, phone: "+52 55 1234 5678", viewerTimezone })).toEqual({
      timezone: "America/Mexico_City",
      source: "phone",
    });
  });

  it("sin ningun dato, la de quien agenda", () => {
    expect(initialInviteeTimezone({ viewerTimezone })).toEqual({ timezone: viewerTimezone, source: "viewer" });
  });

  it("ignora una zona guardada invalida", () => {
    expect(initialInviteeTimezone({ contactTimezone: "basura", viewerTimezone }).source).toBe("viewer");
  });
});
