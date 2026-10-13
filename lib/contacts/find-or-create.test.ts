import { describe, it, expect, vi } from "vitest";
import { findOrCreateContact, findContact } from "./find-or-create";

function fakeService(result: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { service: { rpc } as never, rpc };
}

describe("findOrCreateContact", () => {
  it("manda el workspace, la identidad y los defaults a la funcion de la base", async () => {
    const { service, rpc } = fakeService({
      data: { contact_id: "c1", created: true, matched_by: null, conflict_contact_id: null, conflicts: [], status: "created" },
    });
    const out = await findOrCreateContact(service, {
      workspaceId: "w1",
      identity: { email: "A@x.com" },
      defaults: { display_name: "Ana" },
    });
    expect(rpc).toHaveBeenCalledWith("find_or_create_contact", {
      p_workspace_id: "w1",
      p_identity: { email: "A@x.com" },
      p_defaults: { display_name: "Ana" },
      p_mode: "create",
      p_allow_without_identity: false,
    });
    expect(out).toEqual({
      contactId: "c1", created: true, matchedBy: null, conflictContactId: null, conflicts: [], status: "created",
    });
  });

  it("traduce un contacto encontrado con conflictos", async () => {
    const { service } = fakeService({
      data: {
        contact_id: "c1", created: false, matched_by: "phone", conflict_contact_id: "c2",
        conflicts: [{ by: "email", contact_id: "c2" }], status: "found",
      },
    });
    const out = await findOrCreateContact(service, { workspaceId: "w1", identity: { phone: "+5491122334455" } });
    expect(out.status).toBe("found");
    expect(out.matchedBy).toBe("phone");
    expect(out.conflicts).toEqual([{ by: "email", contact_id: "c2" }]);
    expect(out.conflictContactId).toBe("c2");
  });

  it("un error de la base lanza: nunca se toma como 'no encontrado' (crearia un duplicado)", async () => {
    const { service } = fakeService({ error: { message: "boom" } });
    await expect(findOrCreateContact(service, { workspaceId: "w1", identity: { email: "a@x.com" } })).rejects.toThrow(/boom/);
  });

  it("pasa la marca de alta sin identidad solo cuando se pide", async () => {
    const { service, rpc } = fakeService({ data: { contact_id: "c9", created: true, status: "created" } });
    await findOrCreateContact(service, { workspaceId: "w1", identity: {}, allowWithoutIdentity: true });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_allow_without_identity: true });
  });
});

describe("findContact", () => {
  it("es find_only", async () => {
    const { service, rpc } = fakeService({ data: { contact_id: null, status: "not_found" } });
    const out = await findContact(service, { workspaceId: "w1", identity: { email: "a@x.com" } });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_mode: "find_only" });
    expect(out.contactId).toBeNull();
    expect(out.status).toBe("not_found");
  });
});
