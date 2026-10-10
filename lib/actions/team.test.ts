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
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), createServiceClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => "audit-1") }));
vi.mock("@/lib/audit", () => audit);

import { removeTeamMember, setMemberRole } from "./team";

const WS = { id: "ws-1" };

beforeEach(() => vi.clearAllMocks());

describe("removeTeamMember", () => {
  it("solo el Owner puede quitar miembros", async () => {
    const db = fakeDb({ "workspace_members:select": { data: { role: "admin" } } });
    workspaceMock.getWorkspace.mockResolvedValue({ workspace: WS, user: { id: "u-admin" }, supabase: db.client });
    const r = await removeTeamMember("ws-1", "u-2");
    expect(r).toEqual({ error: "Solo el Owner puede quitar miembros" });
    expect(db.writes()).toHaveLength(0);
  });

  it("nadie se quita a si mismo", async () => {
    const db = fakeDb({ "workspace_members:select": { data: { role: "owner" } } });
    workspaceMock.getWorkspace.mockResolvedValue({ workspace: WS, user: { id: "u-owner" }, supabase: db.client });
    const r = await removeTeamMember("ws-1", "u-owner");
    expect(r).toHaveProperty("error");
    expect(db.writes()).toHaveLength(0);
  });

  it("el Owner quita a otra persona y queda en el historial", async () => {
    const db = fakeDb({ "workspace_members:select": { data: { role: "owner" } } });
    workspaceMock.getWorkspace.mockResolvedValue({ workspace: WS, user: { id: "u-owner" }, supabase: db.client });
    const r = await removeTeamMember("ws-1", "u-2");
    expect(r).toEqual({ ok: true });
    expect(db.writesTo("workspace_members")[0].op).toBe("delete");
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "workspace_member", entityId: "u-2", action: "delete" }));
  });

  it("rechaza un workspace que no es el de la sesion", async () => {
    const db = fakeDb();
    workspaceMock.getWorkspace.mockResolvedValue({ workspace: WS, user: { id: "u-owner" }, supabase: db.client });
    expect(await removeTeamMember("otro", "u-2")).toEqual({ error: "El workspace no coincide" });
  });
});

describe("setMemberRole", () => {
  it("sin team.manage responde que no tiene permiso", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    const r = await setMemberRole({ userId: "u-2", roleId: "r-1" });
    expect(r.ok).toBe(false);
  });

  it("no deja sin Owner al negocio", async () => {
    const db = fakeDb({
      workspace_roles: { data: { id: "r-1", name: "Member", system_role: "member" } },
      workspace_members: (call) =>
        call.op === "select" && call.single
          ? { data: { user_id: "u-2", role: "owner" } }
          : { data: null, count: 1 },
    });
    guards.getPermissionAction.mockResolvedValue({ workspace: WS, user: { id: "u-1" }, supabase: db.client });
    const r = await setMemberRole({ userId: "u-2", roleId: "r-1" });
    expect(r.ok).toBe(false);
    expect(db.writesTo("workspace_members")).toHaveLength(0);
  });

  it("un rol personalizado es siempre 'member' con role_id", async () => {
    const db = fakeDb({
      workspace_roles: { data: { id: "r-9", name: "Closer", system_role: null } },
      workspace_members: (call) => (call.op === "select" ? { data: { user_id: "u-2", role: "member" } } : { data: null }),
    });
    guards.getPermissionAction.mockResolvedValue({ workspace: WS, user: { id: "u-1" }, supabase: db.client });
    const r = await setMemberRole({ userId: "u-2", roleId: "r-9" });
    expect(r).toEqual({ ok: true });
    expect(db.writesTo("workspace_members")[0].values).toEqual({ role: "member", role_id: "r-9" });
  });
});
