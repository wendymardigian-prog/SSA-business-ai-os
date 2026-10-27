import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
let db: MemoryDb;
let role = "admin";
let roleId: string | null = null;

vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "user-1" }, workspace: { id: WS }, role, roleId, supabase: db.client }),
}));

const { listContactTouches } = await import("./contact-touches");
const { TOUCHES_PAGE_SIZE } = await import("@/lib/attribution/attribution");

const touch = (n: number) => ({ id: `t${String(n).padStart(3, "0")}`, workspace_id: WS, contact_id: "c1", occurred_at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(), source: "instagram" });

beforeEach(() => {
  role = "admin";
  roleId = null;
  db = memoryDb({
    contacts: [{ id: "c1", workspace_id: WS, deleted_at: null }],
    contact_touches: Array.from({ length: 25 }, (_, i) => touch(i + 1)),
    workspace_roles: [],
  });
});

describe("listContactTouches", () => {
  it("sin sales.view responde 'sin permiso'", async () => {
    role = "member";
    // El Member de sistema SÍ tiene sales.view; un rol personalizado sin la clave no.
    roleId = "rol-1";
    db.rows("workspace_roles").push({ id: "rol-1", workspace_id: WS, system_role: null, permissions: { keys: ["contacts.view"], scopes: {} } });
    expect(await listContactTouches({ contactId: "c1" })).toMatchObject({ ok: false, error: expect.stringContaining("permiso") });
  });

  it("un contacto que no ve (o que no existe) responde 'sin permiso'", async () => {
    expect(await listContactTouches({ contactId: "ajeno" })).toMatchObject({ ok: false, error: expect.stringContaining("permiso") });
  });

  it("devuelve los más recientes primero, de a 20, con cursor para los anteriores", async () => {
    const first = await listContactTouches({ contactId: "c1" });
    expect(first.ok && first.data.touches).toHaveLength(TOUCHES_PAGE_SIZE);
    expect(first.ok && first.data.touches[0].id).toBe("t025");
    expect(first.ok && first.data.nextCursor).toBeTruthy();
    const second = await listContactTouches({ contactId: "c1", cursor: first.ok ? first.data.nextCursor : null });
    expect(second.ok && second.data.touches.map((t) => t.id)).toEqual(["t005", "t004", "t003", "t002", "t001"]);
    expect(second.ok && second.data.nextCursor).toBeNull();
  });
});

describe("listContactTouches: los nombres para elegir un toque (Extra I, F46)", () => {
  it("trae el título de la pieza y el nombre del anuncio de los toques de la página", async () => {
    db.rows("content_posts").push({ id: "p1", workspace_id: WS, title: "Reel: 3 errores" }, { id: "p2", workspace_id: "ws-2", title: "Ajena" });
    db.rows("meta_ads").push({ workspace_id: WS, ad_id: "33", name: "Video 1" });
    Object.assign(db.rows("contact_touches").find((t) => t.id === "t025")!, { content_post_id: "p1", meta_ad_id: "33" });
    const r = await listContactTouches({ contactId: "c1" });
    expect(r.ok && r.data.names).toEqual({ pieces: { p1: "Reel: 3 errores" }, ads: { "33": "Video 1" } });
  });

  it("sin piezas ni anuncios los nombres vienen vacíos", async () => {
    const r = await listContactTouches({ contactId: "c1" });
    expect(r.ok && r.data.names).toEqual({ pieces: {}, ads: {} });
  });
});
