import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOKING_WINDOW_MS, computeAutoLink, externalEmailsOf, pickBooking, pickContact, type BookingCandidate, type ContactCandidate } from "./linking";

// Las ventanas se prueban con el reloj fijo y en America/Costa_Rica (UTC-6).
const RECORDED = "2026-10-08T21:00:00.000Z"; // 15:00 en Costa Rica
const at = (minutes: number) => new Date(new Date(RECORDED).getTime() + minutes * 60_000).toISOString();

const contact = (id: string, created_at: string, email: string | null, secondary_email: string | null = null): ContactCandidate => ({ id, created_at, email, secondary_email });
const booking = (id: string, over: Partial<BookingCandidate>): BookingCandidate => ({
  id, contact_id: "c-1", host_user_id: "h-other", start_at: RECORDED, created_at: "2026-10-01T00:00:00Z", booker_email: null, status_group: "active", ...over,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T22:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("pickContact", () => {
  it("con dos contactos con el correo del invitado elige el mas reciente", () => {
    const r = pickContact(["lead@x.com"], [contact("viejo", "2026-01-01T00:00:00Z", "lead@x.com"), contact("nuevo", "2026-09-01T00:00:00Z", "LEAD@x.com")]);
    expect(r?.id).toBe("nuevo");
  });
  it("tambien mira el correo secundario", () => {
    expect(pickContact(["lead@x.com"], [contact("c", "2026-01-01T00:00:00Z", null, "lead@x.com")])?.id).toBe("c");
  });
  it("sin contacto con ese correo devuelve null (y nunca crea uno)", () => {
    expect(pickContact(["lead@x.com"], [contact("c", "2026-01-01T00:00:00Z", "otro@x.com")])).toBeNull();
    expect(pickContact([], [contact("c", "2026-01-01T00:00:00Z", "a@x.com")])).toBeNull();
  });
  it("jamas vincula por nombre: el candidato solo tiene correos", () => {
    expect(Object.keys(contact("c", "x", "a@b.com"))).toEqual(["id", "created_at", "email", "secondary_email"]);
  });
});

describe("pickBooking", () => {
  const base = { recordedAt: RECORDED, recorderUserId: "h-me", contactId: "c-1", inviteeEmails: ["lead@x.com"] };

  it("gana la del MISMO anfitrion aunque este mas lejos (3 h) que la de otro (10 min)", () => {
    const r = pickBooking(base, [booking("otro", { start_at: at(10), host_user_id: "h-other" }), booking("mio", { start_at: at(180), host_user_id: "h-me" })]);
    expect(r?.id).toBe("mio");
  });
  it("con el mismo anfitrion, gana la mas cercana (30 min vs 2 h)", () => {
    const r = pickBooking(base, [booking("lejos", { start_at: at(120), host_user_id: "h-me" }), booking("cerca", { start_at: at(-30), host_user_id: "h-me" })]);
    expect(r?.id).toBe("cerca");
  });
  it("con todo igual, gana la creada mas recientemente", () => {
    const r = pickBooking(base, [booking("a", { created_at: "2026-10-01T00:00:00Z" }), booking("b", { created_at: "2026-10-05T00:00:00Z" })]);
    expect(r?.id).toBe("b");
  });
  it("a 4 h exactas entra; a 4 h 01 min no", () => {
    expect(BOOKING_WINDOW_MS).toBe(4 * 3600_000);
    expect(pickBooking(base, [booking("justo", { start_at: at(240) })])?.id).toBe("justo");
    expect(pickBooking(base, [booking("pasada", { start_at: at(241) })])).toBeNull();
    expect(pickBooking(base, [booking("antes", { start_at: at(-241) })])).toBeNull();
  });
  it("una agenda cancelada en la ventana no se elige", () => {
    expect(pickBooking(base, [booking("x", { status_group: "cancelled" })])).toBeNull();
  });
  it("una agenda que ya tiene otra llamada vinculada se puede elegir igual (el candidato no sabe de eso)", () => {
    expect(pickBooking(base, [booking("x", {})])?.id).toBe("x");
  });
  it("matchea por el correo del invitado cuando la llamada no tiene contacto", () => {
    const r = pickBooking({ ...base, contactId: null }, [booking("x", { contact_id: "c-9", booker_email: "LEAD@x.com" }), booking("y", { contact_id: "c-8", booker_email: "otro@x.com" })]);
    expect(r?.id).toBe("x");
  });
  it("de otro contacto y otro correo: no", () => {
    expect(pickBooking(base, [booking("x", { contact_id: "c-9", booker_email: "otro@x.com" })])).toBeNull();
  });
});

describe("externalEmailsOf", () => {
  it("usa los marcados externos", () => {
    expect(externalEmailsOf([{ name: "A", email: "closer@n.io", is_external: false }, { name: "L", email: "Lead@x.com", is_external: true }])).toEqual(["lead@x.com"]);
  });
  it("si Fathom no marca a nadie, todos los que no son del equipo ni quien grabo", () => {
    const r = externalEmailsOf(
      [{ name: "A", email: "closer@n.io", is_external: null }, { name: "B", email: "setter@n.io", is_external: null }, { name: "L", email: "lead@x.com", is_external: null }],
      { teamEmails: ["setter@n.io"], recorderEmail: "closer@n.io" },
    );
    expect(r).toEqual(["lead@x.com"]);
  });
});

describe("computeAutoLink", () => {
  const attendees = [{ name: "L", email: "lead@x.com", is_external: true }];
  const input = { recordedAt: RECORDED, recorderUserId: "h-me", attendees };

  it("contacto + agenda = auto_email_booking", () => {
    const r = computeAutoLink(input, [contact("c-1", "2026-01-01T00:00:00Z", "lead@x.com")], [booking("b", { host_user_id: "h-me" })]);
    expect(r).toEqual({ contact_id: "c-1", booking_id: "b", link_method: "auto_email_booking" });
  });
  it("solo contacto = auto_email", () => {
    expect(computeAutoLink(input, [contact("c-1", "2026-01-01T00:00:00Z", "lead@x.com")], [])).toEqual({ contact_id: "c-1", booking_id: null, link_method: "auto_email" });
  });
  it("solo agenda (por el correo de quien reservo): toma el contacto de la agenda = auto_booking", () => {
    const r = computeAutoLink(input, [], [booking("b", { contact_id: "c-7", booker_email: "lead@x.com" })]);
    expect(r).toEqual({ contact_id: "c-7", booking_id: "b", link_method: "auto_booking" });
  });
  it("nada = none, sin contacto", () => {
    expect(computeAutoLink(input, [], [])).toEqual({ contact_id: null, booking_id: null, link_method: "none" });
  });
});
