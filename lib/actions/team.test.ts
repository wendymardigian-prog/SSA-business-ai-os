/**
 * Caracterizacion de las acciones de Equipo (Llamadas, §4.3), ANTES de sumar
 * la marca de closer y la revocacion de Fathom al salir.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const workspaceMock = vi.hoisted(() => ({ getWorkspace: vi.fn() }));
vi.mock("@/lib/workspace", () => workspaceMock);
const guards = vi.hoisted(() => ({ getPermissionAction: vi.fn() }));
vi.mock("@/lib/auth/guards", () => guards);
const serverMock = vi.hoisted(() => ({ service: {} as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), createServiceClient: vi.fn(async () => serverMock.service) }));
const revoke = vi.hoisted(() => ({ revokeFathomConnectionsOf: vi.fn(async () => 1) }));
vi.mock("@/lib/fathom/revoke", () => revoke);
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => "audit-1") }));
vi.mock("@/lib/audit", () => audit);

import { removeTeamMember, setMemberCloser, setMemberRole } from "./team";

const WS = { id: "ws-1" };

beforeEach(() => { vi.clearAllMocks(); serverMock.service = {}; });

import { SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";

/** El contexto que devuelve el guard `getPermissionAction`: lo minimo que usan las acciones. */
function ctxOf(supabase: unknown, userId: string, role: "owner" | "admin" | "member" = "owner") {
  return { workspace: WS, user: { id: userId }, supabase, role, roleId: null, permissions: SYSTEM_ROLE_PERMISSIONS[role], can: () => true };
}

describe("removeTeamMember", () => {
  it("solo el Owner puede quitar miembros: sin team.remove no se escribe nada", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    const r = await removeTeamMember("ws-1", "u-2");
    expect(r).toEqual({ ok: false, error: "Solo el Owner puede quitar miembros" });
    expect(guards.getPermissionAction).toHaveBeenCalledWith("team.remove");
  });

  it("nadie se quita a si mismo", async () => {
    const db = fakeDb({ "workspace_members:select": { data: { user_id: "u-owner", role: "owner" } } });
    guards.getPermissionAction.mockResolvedValue(ctxOf(db.client, "u-owner"));
    const r = await removeTeamMember("ws-1", "u-owner");
    expect(r.ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("el Owner quita a otra persona y queda en el historial", async () => {
    const db = fakeDb({ "workspace_members:select": { data: { user_id: "u-2", role: "member" } } });
    guards.getPermissionAction.mockResolvedValue(ctxOf(db.client, "u-owner"));
    const r = await removeTeamMember("ws-1", "u-2");
    expect(r).toEqual({ ok: true });
    expect(db.writesTo("workspace_members")[0].op).toBe("delete");
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "workspace_member", entityId: "u-2", action: "delete", metadata: expect.objectContaining({ kind: "member_removed" }) }));
  });

  it("al salir se desconecta su Fathom (sus llamadas quedan)", async () => {
    const db = fakeDb({ "workspace_members:select": { data: { user_id: "u-2", role: "member" } } });
    guards.getPermissionAction.mockResolvedValue(ctxOf(db.client, "u-owner"));
    await removeTeamMember("ws-1", "u-2");
    expect(revoke.revokeFathomConnectionsOf).toHaveBeenCalledWith(serverMock.service, "ws-1", "u-2");
    expect(db.writesTo("calls")).toHaveLength(0);
  });

  it("si revocar el Fathom falla, salir del equipo igual quedo hecho", async () => {
    revoke.revokeFathomConnectionsOf.mockRejectedValueOnce(new Error("vault caido"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ "workspace_members:select": { data: { user_id: "u-2", role: "member" } } });
    guards.getPermissionAction.mockResolvedValue(ctxOf(db.client, "u-owner"));
    expect(await removeTeamMember("ws-1", "u-2")).toEqual({ ok: true });
    spy.mockRestore();
  });

  it("a quien no tiene team.remove no le revoca nada", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    await removeTeamMember("ws-1", "u-2");
    expect(revoke.revokeFathomConnectionsOf).not.toHaveBeenCalled();
  });

  it("rechaza un workspace que no es el de la sesion", async () => {
    const db = fakeDb();
    guards.getPermissionAction.mockResolvedValue(ctxOf(db.client, "u-owner"));
    expect(await removeTeamMember("otro", "u-2")).toEqual({ ok: false, error: "El workspace no coincide" });
  });

  it("no se queda el negocio sin Owner", async () => {
    const db = fakeDb({
      workspace_members: (call) => (call.op === "select" && call.single ? { data: { user_id: "u-2", role: "owner" } } : { data: null, count: 1 }),
    });
    guards.getPermissionAction.mockResolvedValue(ctxOf(db.client, "u-owner"));
    const r = await removeTeamMember("ws-1", "u-2");
    expect(r.ok).toBe(false);
    expect(db.writesTo("workspace_members")).toHaveLength(0);
  });
});

describe("setMemberRole", () => {
  it("sin team.manage responde que no tiene permiso", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    const r = await setMemberRole({ userId: "u-2", roleId: "r-1" });
    expect(r.ok).toBe(false);
  });

  it("nadie toca al Owner: ni para dejar al negocio sin Owner", async () => {
    const db = fakeDb({
      workspace_roles: { data: { id: "r-1", name: "Member", system_role: "member" } },
      workspace_members: (call) =>
        call.op === "select" && call.single
          ? { data: { user_id: "u-2", role: "owner" } }
          : { data: null, count: 1 },
    });
    guards.getPermissionAction.mockResolvedValue(ctxOf(db.client, "u-1"));
    const r = await setMemberRole({ userId: "u-2", roleId: "r-1" });
    expect(r.ok).toBe(false);
    expect(db.writesTo("workspace_members")).toHaveLength(0);
  });

  it("un rol personalizado es siempre 'member' con role_id", async () => {
    const db = fakeDb({
      workspace_roles: { data: { id: "r-9", name: "Closer", system_role: null } },
      workspace_members: (call) => (call.op === "select" ? { data: { user_id: "u-2", role: "member" } } : { data: null }),
    });
    guards.getPermissionAction.mockResolvedValue(ctxOf(db.client, "u-1"));
    const r = await setMemberRole({ userId: "u-2", roleId: "r-9" });
    expect(r).toEqual({ ok: true });
    expect(db.writesTo("workspace_members")[0].values).toEqual({ role: "member", role_id: "r-9" });
  });

  it("nadie se cambia su propio rol (ataque: un rol con team.manage se asigna otro)", async () => {
    const db = fakeDb({
      workspace_roles: { data: { id: "r-9", name: "Closer", system_role: null } },
      workspace_members: (call) => (call.op === "select" ? { data: { user_id: "u-1", role: "member" } } : { data: null }),
    });
    guards.getPermissionAction.mockResolvedValue(ctxOf(db.client, "u-1", "admin"));
    const r = await setMemberRole({ userId: "u-1", roleId: "r-9" });
    expect(r.ok).toBe(false);
    expect(db.writesTo("workspace_members")).toHaveLength(0);
  });

  it("un rol con team.manage NO da el rol Admin (solo Owner y Admin)", async () => {
    const db = fakeDb({
      workspace_roles: { data: { id: "r-admin", name: "Admin", system_role: "admin" } },
      workspace_members: (call) => (call.op === "select" ? { data: { user_id: "u-2", role: "member" } } : { data: null }),
    });
    guards.getPermissionAction.mockResolvedValue({
      ...ctxOf(db.client, "u-1", "member"),
      roleId: "r-x",
      permissions: { keys: ["team.manage"], scopes: SYSTEM_ROLE_PERMISSIONS.member.scopes },
    });
    const r = await setMemberRole({ userId: "u-2", roleId: "r-admin" });
    expect(r.ok).toBe(false);
    expect(db.writesTo("workspace_members")).toHaveLength(0);
  });
});

describe("setMemberCloser (F4)", () => {
  const profiles = [
    { user_id: "u-ana", email: "ana@negocio.io", full_name: "Ana Pérez", meta_name: null },
    { user_id: "u-beto", email: "beto@negocio.io", full_name: "Beto Mora", meta_name: null },
  ];
  const members = [
    { user_id: "u-ana", is_closer: false, closer_emails: [] as string[] },
    { user_id: "u-beto", is_closer: true, closer_emails: ["beto.personal@gmail.com"] },
  ];
  function setup() {
    const db = fakeDb({ "workspace_members:select": { data: members } }, { workspace_member_profiles: { data: profiles as never } });
    serverMock.service = db.client;
    guards.getPermissionAction.mockResolvedValue(ctxOf(fakeDb().client, "u-owner"));
    return db;
  }

  it("normaliza el correo: ' ANA.Personal@Gmail.com ' se guarda como ana.personal@gmail.com", async () => {
    const db = setup();
    const r = await setMemberCloser({ userId: "u-ana", isCloser: true, closerEmails: [" ANA.Personal@Gmail.com "] });
    expect(r).toEqual({ ok: true, emails: ["ana.personal@gmail.com"] });
    expect(db.writesTo("workspace_members")[0].values).toEqual({ is_closer: true, closer_emails: ["ana.personal@gmail.com"] });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "workspace_member", entityId: "u-ana", action: "update" }));
  });

  it("rechaza un alterno que es el correo de otra persona, nombrandola", async () => {
    const db = setup();
    const r = await setMemberCloser({ userId: "u-ana", isCloser: true, closerEmails: ["beto@negocio.io"] });
    expect(r).toEqual({ ok: false, error: "beto@negocio.io ya es un correo de Beto Mora" });
    expect(db.writes()).toHaveLength(0);
  });

  it("rechaza un alterno que ya es alterno de otra persona", async () => {
    setup();
    const r = await setMemberCloser({ userId: "u-ana", isCloser: true, closerEmails: ["Beto.Personal@gmail.com"] });
    expect(r.ok).toBe(false);
  });

  it("sin team.manage responde sin permiso y no escribe", async () => {
    const db = setup();
    guards.getPermissionAction.mockResolvedValue(null);
    const r = await setMemberCloser({ userId: "u-ana", isCloser: true, closerEmails: [] });
    expect(r.ok).toBe(false);
    expect(db.writes()).toHaveLength(0);
  });

  it("apagar la marca no toca las llamadas ya guardadas", async () => {
    const db = setup();
    await setMemberCloser({ userId: "u-beto", isCloser: false, closerEmails: ["beto.personal@gmail.com"] });
    expect(db.writesTo("calls")).toHaveLength(0);
    expect(db.writesTo("workspace_members")[0].values).toMatchObject({ is_closer: false });
  });

  it("una persona que no esta en el equipo no se puede marcar", async () => {
    setup();
    expect((await setMemberCloser({ userId: "u-fantasma", isCloser: true, closerEmails: [] })).ok).toBe(false);
  });

  it("si no cambio nada, no llena el historial", async () => {
    setup();
    await setMemberCloser({ userId: "u-beto", isCloser: true, closerEmails: ["beto.personal@gmail.com"] });
    expect(audit.logAudit).not.toHaveBeenCalled();
  });
});
