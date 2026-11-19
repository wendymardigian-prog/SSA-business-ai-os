// @plantilla-quitar(servicios)
/**
 * «Crear contacto» del modal «Nuevo servicio» (`createContactForService`): pide `services.create`
 * antes de tocar la base y usa el mismo alta rápida que el asistente de venta (regla única, sin
 * duplicar, `find_or_create_contact` y nunca `find_or_link_contact`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { memoryCentralRpc } from "@/lib/contacts/testing/memory-central";

const WS = "ws-1";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1);
const CONTACT = U(10);

let db: MemoryDb;
let role = "admin";
let centralResult: { data?: unknown; error?: { message: string } } = { data: null };
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const audit = vi.fn(async (_entry: Record<string, unknown>) => null);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: (entry: Record<string, unknown>) => audit(entry) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: ME }, workspace: { id: WS, timezone: "America/Costa_Rica" }, role, roleId: null, supabase: db.client }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: (t: string) => (db.client as unknown as { from: (t: string) => unknown }).from(t),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "find_or_create_contact") {
        if (centralResult.error) return { data: null, error: centralResult.error };
        return { data: centralResult.data ?? memoryCentralRpc(args, db), error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

const { createContactForService } = await import("./services");

beforeEach(() => {
  role = "admin";
  centralResult = { data: null };
  rpcCalls.length = 0;
  audit.mockClear();
  db = memoryDb({
    contacts: [{ id: CONTACT, workspace_id: WS, deleted_at: null }],
    workspace_members: [{ workspace_id: WS, user_id: ME }],
    workspace_roles: [],
  });
});

describe("createContactForService", () => {
  it("sin `services.create` no toca la base", async () => {
    role = "member";
    const r = await createContactForService({ name: "Ana", email: "ana@x.co" });
    expect(r).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("si no hay nadie, crea un contacto nuevo y lo anota con su origen", async () => {
    const r = await createContactForService({ name: "Beto", phone: "+50688887777" });
    expect(r).toMatchObject({ ok: true, created: true, notice: null });
    expect(db.rows("contacts")).toHaveLength(2);
    expect(db.rows("contacts")[1]).toMatchObject({ workspace_id: WS, display_name: "Beto", phone: "+50688887777" });
    expect(rpcCalls.map((c) => c.name)).not.toContain("find_or_link_contact");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "contact", action: "create", metadata: { source: "service_dialog" } }));
  });

  it("si ya existía, usa ese contacto y avisa (no duplica)", async () => {
    centralResult = { data: { contact_id: CONTACT, created: false, matched_by: "phone", conflict_contact_id: null, conflicts: [], status: "found" } };
    const r = await createContactForService({ name: "Ana", phone: "+50688887777" });
    expect(r).toMatchObject({ ok: true, contactId: CONTACT, created: false, notice: "Ya existía: se usó ese contacto." });
    expect(db.rows("contacts")).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("sin email ni teléfono se rechaza sin buscar", async () => {
    expect(await createContactForService({ name: "Dani" })).toMatchObject({ ok: false });
    expect(rpcCalls).toHaveLength(0);
  });
});
