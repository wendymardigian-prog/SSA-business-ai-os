/**
 * Cambio aprobado del Member (plano §9.3, M1): importar contactos pide `contacts.import`, que el Member de
 * sistema ya no tiene. Sin la clave, ninguna de las tres acciones toca la base.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const db = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: "u-1" },
    workspace: { id: "ws-1" },
    role: "member",
    roleId: null,
    supabase: new Proxy({}, { get: () => { db.calls++; throw new Error("no deberia tocar la base"); } }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => { db.calls++; throw new Error("no deberia tocar la base"); } }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
const guards = vi.hoisted(() => ({ getPermissionAction: vi.fn() }));
vi.mock("@/lib/auth/guards", () => guards);

const { startImport, importBatch, finishImport } = await import("./csv-import");

beforeEach(() => {
  db.calls = 0;
  // Un Member de sistema: edita contactos, pero NO importa.
  guards.getPermissionAction.mockImplementation(async (key: string) => (key === "contacts.import" ? null : { user: { id: "u-1" } }));
});

describe("importar contactos pide contacts.import (M1)", () => {
  it("startImport rechaza y no toca la base", async () => {
    const r = await startImport("contactos.csv", 10);
    expect(r).toEqual({ ok: false, error: "No tenés permiso para importar contactos" });
    expect(db.calls).toBe(0);
  });

  it("importBatch rechaza y no toca la base", async () => {
    const r = await importBatch({ importId: "imp-1", rows: [{ a: "1" }], mapping: {}, offset: 0 } as never);
    expect(r).toMatchObject({ ok: false });
    expect(db.calls).toBe(0);
  });

  it("finishImport rechaza y no toca la base", async () => {
    expect(await finishImport("imp-1")).toMatchObject({ ok: false });
    expect(db.calls).toBe(0);
  });

  it("el guard que se pide es contacts.import", async () => {
    await startImport("x.csv", 1);
    expect(guards.getPermissionAction).toHaveBeenCalledWith("contacts.import");
  });
});
