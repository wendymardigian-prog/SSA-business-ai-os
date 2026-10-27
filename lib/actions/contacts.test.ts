/**
 * `linkContacts` (vincular un contacto duplicado con el principal).
 *
 * Fija a quien deja pasar, que valida y que devuelve. La fusion (conversaciones, canales, etiquetas, rellenado, notas,
 * borrado logico y auditoria) la hace `merge_contacts` en la base, en una transaccion: se prueba con la base real en
 * `scripts/verify-contact-merge.mjs`. Aca se prueba que la accion le delega con los argumentos correctos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const MAIN = "00000000-0000-4000-8000-0000000000aa";
const DUP = "00000000-0000-4000-8000-0000000000bb";
let db: MemoryDb;
let svc: MemoryDb;
let admin: boolean;
let mergeResult: { data?: unknown; error?: string };
const audits: Array<Record<string, unknown>> = [];
const revalidated: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (args: Record<string, unknown>) => { audits.push(args); return null; }),
  diffFields: () => null,
}));
vi.mock("@/lib/workspace", () => ({ getWorkspace: async () => ({ user: { id: "user-1" }, workspace: { id: WS }, role: "admin", roleId: null, supabase: db.client }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => svc.client }));
// Un Member de sistema tiene contacts.edit y contacts.assign; borrar, restaurar, fusionar y sacar «no contactar» piden un Admin.
const MEMBER_KEYS = ["contacts.edit", "contacts.assign"];
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) =>
    admin || MEMBER_KEYS.includes(key) ? { user: { id: "user-1" }, workspace: { id: WS }, supabase: db.client } : null,
}));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "UTC" }));

const { linkContacts } = await import("./contacts");

beforeEach(() => {
  admin = true;
  mergeResult = { data: { ok: true, moved: { conversations: 1, conversations_merged: 1, bookings: 1, tasks: 3, sales: 1, sequence_enrollments_cancelled: 1 } } };
  svc = memoryDb({}, { rpc: { merge_contacts: () => { if (mergeResult.error) throw new Error(mergeResult.error); return mergeResult.data; } } });
  audits.length = 0;
  revalidated.length = 0;
  db = memoryDb({
    contacts: [
      { id: MAIN, workspace_id: WS, display_name: "Ana", email: null, phone: "+50688887777", notes: "nota del principal", setter_id: null, vendedor_id: null, metadata: { link_suggestions: [{ contact_id: DUP }, { contact_id: "otro" }] }, deleted_at: null },
      { id: DUP, workspace_id: WS, display_name: "Ana (IG)", email: "ana@x.com", phone: "+50699990000", notes: "nota del duplicado", setter_id: "u-setter", vendedor_id: null, metadata: {}, deleted_at: null },
    ],
    conversations: [
      { id: "cv-main-wa", workspace_id: WS, channel_id: "ch-wa", contact_id: MAIN },
      { id: "cv-dup-wa", workspace_id: WS, channel_id: "ch-wa", contact_id: DUP },
      { id: "cv-dup-ig", workspace_id: WS, channel_id: "ch-ig", contact_id: DUP },
    ],
    contact_channels: [{ id: "cc1", contact_id: DUP, channel_id: "ch-ig", platform_sender_id: "ig-1" }],
    contact_tags: [{ contact_id: MAIN, tag_id: "t1" }, { contact_id: DUP, tag_id: "t1" }, { contact_id: DUP, tag_id: "t2" }],
    workspace_members: [{ workspace_id: WS, user_id: "user-1" }],
  });
});

describe("linkContacts: lo que no cambia", () => {
  it("sin contacts.merge no se toca nada", async () => {
    admin = false;
    const r = await linkContacts(DUP, MAIN);
    expect(r).toEqual({ ok: false, error: "No tenés permiso para fusionar contactos" });
    expect(db.rows("contacts").every((c) => c.deleted_at === null)).toBe(true);
  });

  it("el mismo contacto no se une consigo mismo", async () => {
    expect(await linkContacts(MAIN, MAIN)).toEqual({ ok: false, error: "Es el mismo contacto" });
  });

  it("si falta alguno de los dos (o ya esta borrado) lo dice", async () => {
    db.rows("contacts")[1].deleted_at = "2026-10-01T00:00:00Z";
    expect(await linkContacts(DUP, MAIN)).toEqual({ ok: false, error: "No encontre alguno de los dos contactos" });
    expect(await linkContacts("00000000-0000-4000-8000-0000000000cc", MAIN)).toEqual({ ok: false, error: "No encontre alguno de los dos contactos" });
  });

  it("devuelve el contacto principal", async () => {
    const r = await linkContacts(DUP, MAIN);
    expect(r).toMatchObject({ ok: true, contactId: MAIN });
  });

  it("revalida la ficha de los dos", async () => {
    await linkContacts(DUP, MAIN);
    expect(revalidated).toEqual(expect.arrayContaining([`/dashboard/contacts/${MAIN}`, `/dashboard/contacts/${DUP}`]));
  });
});

describe("linkContacts delega la fusion en la base (R9)", () => {
  it("llama a merge_contacts con el cliente de servicio y los argumentos correctos", async () => {
    await linkContacts(DUP, MAIN);
    expect(svc.rpcCalls).toEqual([{ name: "merge_contacts", args: { p_workspace_id: WS, p_main: MAIN, p_duplicate: DUP, p_actor: "user-1" } }]);
    expect(db.rpcCalls).toEqual([]);
  });

  it("no escribe nada por su cuenta: ni contactos, ni conversaciones, ni historial (todo es de la base)", async () => {
    const before = JSON.stringify(db.tables);
    await linkContacts(DUP, MAIN);
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(audits).toHaveLength(0);
  });

  it("devuelve el principal y el resumen de lo que se unifico", async () => {
    const r = await linkContacts(DUP, MAIN);
    expect(r).toMatchObject({ ok: true, contactId: MAIN, summary: "Se unificaron 2 conversaciones, 1 agenda, 1 venta y 3 tareas." }); // @plantilla-quitar(ventas,tareas)
    // @plantilla-sin(ventas,tareas): expect(r).toMatchObject({ ok: true, contactId: MAIN, summary: "Se unificaron 2 conversaciones y 1 agenda." });
    expect(r.ok && r.notes).toEqual(["Se canceló 1 inscripción repetida a una secuencia."]);
  });

  it("si la base falla, avisa que no se movio nada y no revalida", async () => {
    mergeResult = { error: "deadlock detected" };
    const r = await linkContacts(DUP, MAIN);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("No se movió nada");
    expect(revalidated).toEqual([]);
  });

  it("traduce los codigos de la funcion", async () => {
    mergeResult = { error: "merge_workspace_mismatch" };
    expect(await linkContacts(DUP, MAIN)).toEqual({ ok: false, error: "Los dos contactos tienen que ser del mismo negocio" });
  });

  it("una respuesta sin ok no se toma por buena", async () => {
    mergeResult = { data: {} };
    expect((await linkContacts(DUP, MAIN)).ok).toBe(false);
  });

  it("sin permiso, con el mismo contacto o con uno que falta, NO llega a la base", async () => {
    admin = false;
    await linkContacts(DUP, MAIN);
    admin = true;
    await linkContacts(MAIN, MAIN);
    await linkContacts("00000000-0000-4000-8000-0000000000cc", MAIN);
    expect(svc.rpcCalls).toEqual([]);
  });
});
