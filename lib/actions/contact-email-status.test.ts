/**
 * Cambiar a mano el estado de email de un contacto (E5): pide `contacts.edit`, que la
 * persona vea el contacto, y para sacar un rebote o una queja, un motivo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const h = vi.hoisted(() => ({ ctx: null as unknown, service: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: vi.fn(async (key: string) => (key === "contacts.edit" ? h.ctx : null)) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => (h.service as { client: unknown }).client) }));

import { getPermissionAction } from "@/lib/auth/guards";
import { setContactEmailStatus } from "./contact-email-status";

function setup(contact: Record<string, unknown> | null, rpcError?: { message: string; code: string }) {
  const user = fakeDb({ "contacts:select": { data: contact } });
  const service = fakeDb({}, {
    set_email_status: rpcError ? { data: null, error: rpcError } : { data: { status: "unsubscribed", changed: true } },
  });
  h.ctx = { supabase: user.client, workspace: { id: "ws-1" }, user: { id: "u-1" } };
  h.service = service;
  return { user, service };
}

const CONTACT = { id: "c-1", email: "ana@x.test", secondary_email: null, email_status: "subscribed" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setContactEmailStatus", () => {
  it("pide contacts.edit (el mismo permiso que editar el contacto)", async () => {
    setup(CONTACT);
    h.ctx = null;
    expect(await setContactEmailStatus("c-1", "unsubscribed")).toMatchObject({ ok: false });
    expect(getPermissionAction).toHaveBeenCalledWith("contacts.edit");
  });

  it("da de baja en modo admin, con quien lo hizo, por la funcion central", async () => {
    const { service } = setup(CONTACT);
    expect(await setContactEmailStatus("c-1", "unsubscribed")).toEqual({ ok: true });
    expect(service.rpcCalls[0]).toMatchObject({
      name: "set_email_status",
      args: { p_contact_id: "c-1", p_status: "unsubscribed", p_source: "admin", p_mode: "admin", p_performed_by: "u-1", p_address: "ana@x.test" },
    });
  });

  it("un contacto que la persona no ve (su RLS) no se toca", async () => {
    const { service } = setup(null);
    expect(await setContactEmailStatus("c-1", "unsubscribed")).toEqual({ ok: false, error: "No encontré ese contacto." });
    expect(service.rpcCalls).toEqual([]);
  });

  it("a mano solo se elige suscripto o dado de baja (rebote y spam los pone el sistema)", async () => {
    setup(CONTACT);
    expect(await setContactEmailStatus("c-1", "bounced")).toMatchObject({ ok: false });
    expect(await setContactEmailStatus("c-1", "cualquiera")).toMatchObject({ ok: false });
  });

  it("volver a suscribir a quien rebota pide un motivo, y con el motivo pasa", async () => {
    const { service } = setup({ ...CONTACT, email_status: "bounced" });
    expect(await setContactEmailStatus("c-1", "subscribed")).toMatchObject({ ok: false, error: expect.stringContaining("por qué") });
    expect(service.rpcCalls).toEqual([]);
    expect(await setContactEmailStatus("c-1", "subscribed", "Confirmó que el buzón anda")).toEqual({ ok: true });
    expect(service.rpcCalls[0].args).toMatchObject({ p_status: "subscribed", p_reason: "Confirmó que el buzón anda" });
  });

  it("si la base igual pide el motivo (EM002), el mensaje es claro", async () => {
    setup({ ...CONTACT, email_status: "unsubscribed" }, { message: "motivo", code: "EM002" });
    expect(await setContactEmailStatus("c-1", "subscribed")).toMatchObject({ ok: false, error: expect.stringContaining("por qué") });
  });

  it("sin email no hay nada que cambiar", async () => {
    setup({ ...CONTACT, email: null });
    expect(await setContactEmailStatus("c-1", "unsubscribed")).toEqual({ ok: false, error: "Este contacto no tiene email." });
  });
});
