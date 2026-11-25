/**
 * Eliminar y restaurar un contacto (`softDeleteContact`, `restoreContact`).
 *
 * La política de lectura de `contacts` y `conversations` esconde lo borrado (`deleted_at IS NULL`, 00024), y Postgres
 * se la exige también a la fila NUEVA de un UPDATE con WHERE: con la sesión, eliminar fallaba siempre («new row
 * violates row-level security policy», también para el Owner) y restaurar no encontraba la fila (0 filas, sin error,
 * y respondía «listo»). Acá la sesión es una base aparte que solo tiene lo que la persona ve y RECHAZA cualquier
 * UPDATE sobre esas dos tablas, como la base real: si la acción vuelve a escribir con la sesión, estas pruebas fallan.
 * Traído de RER-BAIOS (#104): en SSA la política es la misma (00024).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const ME = "user-1";
const C1 = "00000000-0000-4000-8000-0000000000c1";
const MINE = "00000000-0000-4000-8000-0000000000c2";
const OTHER_WS = "00000000-0000-4000-8000-0000000000c3";

type Ctx = { role: string; scope: (m: string) => string; canDelete: boolean };
let ctx: Ctx;
let svc: MemoryDb;
let session: MemoryDb;
let sessionWrites: string[];
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (args: Record<string, unknown>) => { audits.push(args); return null; }),
  diffFields: () => null,
}));
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => ({ user: { id: ME }, workspace: { id: WS }, role: ctx.role, supabase: sessionClient() }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => svc.client }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) =>
    key === "contacts.delete" && ctx.canDelete
      ? { user: { id: ME }, workspace: { id: WS }, role: ctx.role, scope: ctx.scope, supabase: sessionClient() }
      : null,
}));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "UTC" }));

/** La sesión: lee lo que ve; un UPDATE sobre contactos o conversaciones choca con la RLS, como en Postgres. */
function sessionClient() {
  const client = session.client as unknown as { from: (t: string) => Record<string, unknown> };
  return {
    ...client,
    from(table: string) {
      const builder = client.from(table);
      if (table !== "contacts" && table !== "conversations") return builder;
      return {
        ...builder,
        update: () => {
          sessionWrites.push(table);
          const rejected = { data: null, error: { code: "42501", message: `new row violates row-level security policy for table "${table}"` } };
          const chain: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => Promise.resolve(rejected).then(resolve) };
          for (const m of ["eq", "is", "not", "or", "select", "in"]) chain[m] = () => chain;
          return chain;
        },
      };
    },
  };
}

const { softDeleteContact, restoreContact } = await import("./contacts");

const contact = (id: string, extra: Record<string, unknown> = {}) => ({
  id, workspace_id: WS, display_name: id, setter_id: null, vendedor_id: null, deleted_at: null, ...extra,
});

beforeEach(() => {
  ctx = { role: "owner", scope: () => "all", canDelete: true };
  sessionWrites = [];
  audits.length = 0;
  const rows = [contact(C1), contact(MINE, { setter_id: ME }), contact(OTHER_WS, { workspace_id: "ws-2" })];
  svc = memoryDb({
    contacts: rows.map((r) => ({ ...r })),
    conversations: [
      { id: "cv-1", workspace_id: WS, contact_id: C1, deleted_at: null },
      { id: "cv-2", workspace_id: WS, contact_id: MINE, deleted_at: null },
    ],
  });
  // La sesión ve solo los contactos vivos de su negocio (la RLS).
  session = memoryDb({ contacts: rows.filter((r) => r.workspace_id === WS).map((r) => ({ ...r })) });
});

const svcContact = (id: string) => svc.rows("contacts").find((r) => r.id === id)!;
const svcConv = (id: string) => svc.rows("conversations").find((r) => r.id === id)!;

describe("softDeleteContact", () => {
  it("el Owner elimina: escribe con el servicio, nunca con la sesión, y se lleva sus conversaciones", async () => {
    const res = await softDeleteContact(C1);
    expect(res).toEqual({ ok: true, contactId: C1 });
    expect(sessionWrites).toEqual([]);
    expect(svcContact(C1).deleted_at).toBeTruthy();
    expect(svcConv("cv-1").deleted_at).toBeTruthy();
    expect(svcConv("cv-2").deleted_at).toBeNull();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityId: C1, action: "delete", workspaceId: WS, performedBy: ME });
  });

  it("sin el permiso no escribe nada", async () => {
    ctx.canDelete = false;
    const res = await softDeleteContact(C1);
    expect(res.ok).toBe(false);
    expect(svcContact(C1).deleted_at).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it("un contacto que la sesión no ve (otro negocio, o fuera de su alcance) no se toca", async () => {
    const res = await softDeleteContact(OTHER_WS);
    expect(res).toEqual({ ok: false, error: "No encuentro ese contacto" });
    expect(svcContact(OTHER_WS).deleted_at).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it("el segundo clic no vuelve a eliminar ni deja otra entrada en el historial", async () => {
    await softDeleteContact(C1);
    session.rows("contacts").find((r) => r.id === C1)!.deleted_at = "2026-11-24T00:00:00Z";
    const res = await softDeleteContact(C1);
    expect(res.ok).toBe(false);
    expect(audits).toHaveLength(1);
  });
});

describe("restoreContact", () => {
  beforeEach(async () => {
    await softDeleteContact(C1);
    await softDeleteContact(MINE);
    audits.length = 0;
  });

  it("restaura con el servicio, devuelve sus conversaciones y deja historial", async () => {
    const res = await restoreContact(C1);
    expect(res).toEqual({ ok: true, contactId: C1 });
    expect(sessionWrites).toEqual([]);
    expect(svcContact(C1).deleted_at).toBeNull();
    expect(svcConv("cv-1").deleted_at).toBeNull();
    expect(audits[0]).toMatchObject({ entityId: C1, action: "restore", performedBy: ME });
  });

  it("si no hay nada que restaurar da error, no «listo»", async () => {
    await restoreContact(C1);
    audits.length = 0;
    expect(await restoreContact(C1)).toEqual({ ok: false, error: "No encuentro ese contacto en la Papelera" });
    expect(await restoreContact(OTHER_WS)).toEqual({ ok: false, error: "No encuentro ese contacto en la Papelera" });
    expect(audits).toHaveLength(0);
  });

  it("con alcance «solo lo mío» restaura solo los contactos donde es setter o vendedor", async () => {
    ctx = { role: "member", scope: () => "own", canDelete: true };
    expect((await restoreContact(C1)).ok).toBe(false);
    expect(svcContact(C1).deleted_at).toBeTruthy();
    expect(await restoreContact(MINE)).toEqual({ ok: true, contactId: MINE });
    expect(svcContact(MINE).deleted_at).toBeNull();
  });
});
