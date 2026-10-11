import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type DbHandler } from "@/lib/testing/fake-db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const guards = vi.hoisted(() => ({ getPermissionAction: vi.fn() }));
vi.mock("@/lib/auth/guards", () => guards);
const server = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => server.service }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => "a1") }));
vi.mock("@/lib/audit", () => audit);

import { linkCallBooking, linkCallContact, searchContactsForCall, suggestBookingsForCall } from "./calls-link";

const WS = "ws-1";
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const CALL = U(1), CONTACT = U(2), OTHER_CONTACT = U(3), BOOKING = U(4), ME = U(5);

const callRow = { id: CALL, workspace_id: WS, contact_id: null as string | null, booking_id: null as string | null, link_method: "none", recorded_at: "2026-10-08T21:00:00Z", recorded_by_user_id: ME, recorded_by_email: "ana@negocio.io", attendees: [], transcript: [] };

function setup(handlers: Record<string, DbHandler> = {}) {
  const user = fakeDb({ "calls:select": { data: callRow }, "contacts:select": { data: { id: CONTACT } }, "bookings:select": { data: { id: BOOKING, contact_id: CONTACT } }, ...handlers });
  const service = fakeDb();
  server.service = service.client;
  guards.getPermissionAction.mockResolvedValue({ workspace: { id: WS }, user: { id: ME }, supabase: user.client });
  return { user, service };
}

beforeEach(() => vi.clearAllMocks());

describe("linkCallContact", () => {
  it("vincula a mano: link_method manual, quien y cuando, y deja el antes y el despues en el historial", async () => {
    const { service } = setup();
    const r = await linkCallContact({ callId: CALL, contactId: CONTACT });
    expect(r).toEqual({ ok: true });
    expect(service.writesTo("calls")[0].values).toMatchObject({ contact_id: CONTACT, link_method: "manual", linked_by: ME });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "call", action: "call.linked", changes: { contact_id: { old: null, new: CONTACT } }, performedBy: ME }));
  });

  it("un contacto que quien vincula no ve (el id mandado a mano) se rechaza", async () => {
    const { service } = setup({ "contacts:select": { data: null } });
    const r = await linkCallContact({ callId: CALL, contactId: OTHER_CONTACT });
    expect(r).toEqual({ ok: false, error: "No encontré ese contacto" });
    expect(service.writes()).toHaveLength(0);
  });

  it("una llamada que quien vincula no ve es como si no existiera", async () => {
    const { service } = setup({ "calls:select": { data: null } });
    expect((await linkCallContact({ callId: CALL, contactId: CONTACT })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });

  it("desvincular: el contacto queda en null y se audita como call.unlinked", async () => {
    const { service } = setup({ "calls:select": { data: { ...callRow, contact_id: CONTACT } } });
    await linkCallContact({ callId: CALL, contactId: null });
    expect(service.writesTo("calls")[0].values).toMatchObject({ contact_id: null, link_method: "none" });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.unlinked" }));
  });

  it("si no cambia nada no escribe", async () => {
    const { service } = setup({ "calls:select": { data: { ...callRow, contact_id: CONTACT } } });
    expect(await linkCallContact({ callId: CALL, contactId: CONTACT })).toEqual({ ok: true });
    expect(service.writes()).toHaveLength(0);
  });

  it("sin calls.edit o con ids que no son uuid, rechaza", async () => {
    setup();
    expect((await linkCallContact({ callId: "x", contactId: CONTACT })).ok).toBe(false);
    guards.getPermissionAction.mockResolvedValue(null);
    expect((await linkCallContact({ callId: CALL, contactId: CONTACT })).ok).toBe(false);
  });
});

describe("linkCallBooking", () => {
  it("vincula la agenda y la deja en el historial", async () => {
    const { service } = setup({ "calls:select": { data: { ...callRow, contact_id: CONTACT } } });
    expect(await linkCallBooking({ callId: CALL, bookingId: BOOKING })).toEqual({ ok: true });
    expect(service.writesTo("calls")[0].values).toMatchObject({ booking_id: BOOKING, link_method: "manual" });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.linked", changes: { booking_id: { old: null, new: BOOKING } } }));
  });

  it("una agenda de OTRO contacto se permite pero avisa, y el contacto de la llamada no cambia", async () => {
    const { service } = setup({ "calls:select": { data: { ...callRow, contact_id: OTHER_CONTACT } } });
    const r = await linkCallBooking({ callId: CALL, bookingId: BOOKING });
    expect(r.ok).toBe(true);
    expect(r.ok && r.warning).toContain("otro contacto");
    expect(service.writesTo("calls")[0].values).not.toHaveProperty("contact_id");
  });

  it("una agenda que no ve se rechaza", async () => {
    const { service } = setup({ "bookings:select": { data: null } });
    expect((await linkCallBooking({ callId: CALL, bookingId: BOOKING })).ok).toBe(false);
    expect(service.writes()).toHaveLength(0);
  });
});

describe("buscar y sugerir", () => {
  it("el buscador devuelve solo lo que la RLS deja ver y no busca con menos de 2 letras", async () => {
    const { user } = setup({ "contacts:select": { data: [{ id: CONTACT, display_name: "Ana Pérez", email: "ana@x.com" }] } });
    expect(await searchContactsForCall("a")).toEqual([]);
    expect(await searchContactsForCall("ana")).toEqual([{ id: CONTACT, name: "Ana Pérez", email: "ana@x.com" }]);
    expect(user.calls.every((c) => c.table === "contacts")).toBe(true);
  });

  it("las sugerencias se ordenan correo > nombre > fecha, con el motivo", async () => {
    setup({
      "calls:select": { data: { ...callRow, attendees: [{ name: "Lead Uno", email: "lead@x.com", is_external: true }] } },
      "bookings:select": (call) => {
        const f = call.filters.map((x) => x.method);
        if (f.includes("in")) return { data: [{ id: "b-mail", start_at: "2026-10-08T20:00:00Z", booker_email: "lead@x.com", booker_name: "Lead" }] };
        if (f.includes("or")) return { data: [{ id: "b-nombre", start_at: "2026-10-08T19:00:00Z", booker_email: null, booker_name: "Lead Uno" }] };
        return { data: [{ id: "b-fecha", start_at: "2026-10-08T22:00:00Z", booker_email: null, booker_name: "Otro" }] };
      },
    });
    const r = await suggestBookingsForCall({ callId: CALL, timeZone: "America/Costa_Rica" });
    expect(r.map((s) => [s.id, s.match])).toEqual([["b-mail", "email"], ["b-nombre", "nombre"], ["b-fecha", "fecha"]]);
    expect(r[0].reason).toBeTruthy();
  });
});
