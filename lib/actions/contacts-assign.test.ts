/**
 * Ventas F15: asignar a mano setter o vendedor BLOQUEA la asignacion automatica
 * (`assignment_locked_at`), y lo que cambia sigue auditandose como una accion de
 * una persona.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
let db: MemoryDb;
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (args: Record<string, unknown>) => { audits.push(args); return null; }),
  diffFields: (before: Record<string, unknown>, patch: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { old: before[k] ?? null, new: v }])),
}));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "user-1" }, workspace: { id: WS }, role: "admin", roleId: null, supabase: db.client }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
// Un Member de sistema: puede editar y reasignar (contacts.edit / contacts.assign), no borrar ni fusionar.
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) => (["contacts.edit", "contacts.assign"].includes(key) ? { user: { id: "user-1" }, workspace: { id: "ws-1" }, supabase: null } : null),
}));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "UTC" }));

const { assignContact } = await import("./contacts");

beforeEach(() => {
  audits.length = 0;
  db = memoryDb({
    contacts: [{ id: "c1", workspace_id: WS, setter_id: null, vendedor_id: null, assignment_locked_at: null }],
    workspace_members: [{ workspace_id: WS, user_id: "ana" }],
  });
});

describe("assignContact", () => {
  it("asignar a mano escribe assignment_locked_at y se audita como persona", async () => {
    const r = await assignContact("c1", { setter_id: "ana" });
    expect(r).toMatchObject({ ok: true });
    expect(db.rows("contacts")[0].setter_id).toBe("ana");
    expect(db.rows("contacts")[0].assignment_locked_at).toBeTruthy();
    expect(audits[0]).toMatchObject({ action: "assign", performedBy: "user-1" });
  });

  it("sacar la asignación a mano también bloquea (quedó decidido por una persona)", async () => {
    db.rows("contacts")[0].setter_id = "ana";
    await assignContact("c1", { setter_id: null });
    expect(db.rows("contacts")[0].setter_id).toBeNull();
    expect(db.rows("contacts")[0].assignment_locked_at).toBeTruthy();
  });

  it("una persona que no es miembro se rechaza y no bloquea nada", async () => {
    const r = await assignContact("c1", { vendedor_id: "extraño" });
    expect(r).toMatchObject({ ok: false });
    expect(db.rows("contacts")[0].assignment_locked_at).toBeNull();
  });

  it("sin nada que cambiar no escribe", async () => {
    expect(await assignContact("c1", {})).toMatchObject({ ok: true });
    expect(db.rows("contacts")[0].assignment_locked_at).toBeNull();
  });
});
