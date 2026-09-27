import { describe, it, expect } from "vitest";
import {
  validateEventDetails,
  isSafeRedirectUrl,
  activationChecklist,
  canActivate,
  meetRequiresWritableGoogleCalendar,
  MEET_NEEDS_GOOGLE_CALENDAR,
  validateEventLimits,
  EVENT_COLORS,
  type ActivationContext,
} from "./event-validation";
import { defaultBookingFields } from "./booking-fields";
import type { EventType } from "./types";

const event: EventType = {
  id: "e1",
  owner_user_id: "u1",
  title: "Llamada de triaje",
  slug: "llamada-de-triaje",
  duration_minutes: 30,
  color: EVENT_COLORS[0],
  location_type: "google_meet",
  status: "inactive",
  before_buffer_minutes: 0,
  after_buffer_minutes: 0,
  minimum_notice_minutes: 120,
  period_type: "rolling_calendar",
  period_days: 60,
  booking_fields: defaultBookingFields(),
};

const ctx: ActivationContext = {
  scheduleName: "Horario normal",
  destinationCalendar: { name: "wendy@gmail.com", provider: "google", writable: true },
  formValid: true,
  enabledFlows: 0,
};

describe("validateEventDetails (F18)", () => {
  it("acepta un evento completo", () => {
    expect(validateEventDetails(event).ok).toBe(true);
  });

  it("la URL de redirección tiene que empezar con https://", () => {
    const r = validateEventDetails({ ...event, success_redirect_url: "http://mi-web.com/gracias" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toEqual({ path: "success_redirect_url", message: "La URL de redirección tiene que empezar con https://" });
    expect(validateEventDetails({ ...event, success_redirect_url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateEventDetails({ ...event, success_redirect_url: "https://mi-web.com/gracias?x=1" }).ok).toBe(true);
    expect(validateEventDetails({ ...event, success_redirect_url: null }).ok).toBe(true);
  });

  it("isSafeRedirectUrl rechaza credenciales embebidas y URLs rotas", () => {
    expect(isSafeRedirectUrl("https://user:pass@mi-web.com/")).toBe(false);
    expect(isSafeRedirectUrl("https://")).toBe(false);
    expect(isSafeRedirectUrl("HTTPS://MI-WEB.COM")).toBe(true);
    expect(isSafeRedirectUrl(42)).toBe(false);
  });

  it("duración de 5 a 480, color de la paleta, ubicación manual con texto", () => {
    expect(validateEventDetails({ ...event, duration_minutes: 3 }).ok).toBe(false);
    expect(validateEventDetails({ ...event, duration_minutes: 481 }).ok).toBe(false);
    expect(validateEventDetails({ ...event, duration_minutes: 25 }).ok).toBe(true);
    expect(validateEventDetails({ ...event, color: "#123456" }).ok).toBe(false);
    expect(validateEventDetails({ ...event, location_type: "manual", location_text: "  " }).ok).toBe(false);
    expect(validateEventDetails({ ...event, location_type: "manual", location_text: "Oficina, San José" }).ok).toBe(true);
    expect(validateEventDetails({ ...event, slug: "Con Mayúsculas" }).ok).toBe(false);
  });
});

describe("Listo para activar (F18)", () => {
  it("con todo cargado, los tres obligatorios están ok y se puede activar aunque no haya flujos", () => {
    const list = activationChecklist(event, ctx);
    expect(list.map((i) => [i.key, i.required, i.ok])).toEqual([
      ["details", true, true],
      ["schedule", true, true],
      ["calendar", true, true],
      ["form", false, true],
      ["flows", false, false],
    ]);
    expect(list[1].label).toBe("Horario: Horario normal");
    expect(canActivate(list)).toEqual({ ok: true, blockers: [] });
  });

  it("Meet sin calendario de Google con escritura advierte y bloquea la activación", () => {
    const sinEscritura = { ...ctx, destinationCalendar: { name: "lectura", provider: "google" as const, writable: false } };
    expect(meetRequiresWritableGoogleCalendar(event, sinEscritura)).toBe(MEET_NEEDS_GOOGLE_CALENDAR);
    const list = activationChecklist(event, sinEscritura);
    expect(canActivate(list)).toEqual({ ok: false, blockers: [MEET_NEEDS_GOOGLE_CALENDAR] });

    // Con ubicación manual no hace falta escritura.
    expect(meetRequiresWritableGoogleCalendar({ location_type: "manual" }, sinEscritura)).toBeNull();
  });

  it("sin horario ni calendario, 'Activar evento' queda deshabilitado con los motivos; formulario y flujos no bloquean", () => {
    const list = activationChecklist(event, { ...ctx, scheduleName: null, destinationCalendar: null, formValid: false });
    const r = canActivate(list);
    expect(r.ok).toBe(false);
    expect(r.blockers).toEqual(["Elegí un horario o creá el horario por defecto", "Elegí un calendario destino"]);
  });

  it("detalles inválidos bloquean con el primer error", () => {
    const list = activationChecklist({ ...event, title: "" }, ctx);
    expect(list[0]).toMatchObject({ ok: false, reason: "El título es obligatorio" });
  });
});

describe("Límites y buffers desde el editor (F21)", () => {
  const limits = {
    before_buffer_minutes: 0,
    after_buffer_minutes: 0,
    minimum_notice_minutes: 120,
    period_type: "range" as const,
    period_start_date: "2026-11-10",
    period_end_date: "2026-11-01",
  };

  it("'Entre fechas' con fin anterior al inicio se rechaza", () => {
    expect(validateEventLimits(limits).ok).toBe(false);
  });

  it("aviso mínimo mayor que la ventana advierte 'No va a haber horarios disponibles'", () => {
    const r = validateEventLimits(
      { ...limits, period_type: "rolling_calendar", period_days: 1, minimum_notice_minutes: 3 * 1440 },
      new Date("2026-10-06T16:10:00.000Z"),
      "America/Costa_Rica",
    );
    expect(r).toEqual({ ok: true, warnings: ["no_slots_possible"] });
  });
});
