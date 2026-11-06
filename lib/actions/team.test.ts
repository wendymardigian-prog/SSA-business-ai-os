/**
 * Caracterizacion de las acciones de Equipo (Llamadas, §4.3), ANTES de sumar
 * la revocacion de Fathom al salir.
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

import { removeTeamMember, setMemberRole } from "./team";

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
