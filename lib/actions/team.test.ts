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

  it("al salir se desconecta su Fathom (sus llamadas quedan)", async () => {
    const db = fakeDb({ "workspace_members:select": { data: { role: "owner" } } });
    workspaceMock.getWorkspace.mockResolvedValue({ workspace: WS, user: { id: "u-owner" }, supabase: db.client });
    await removeTeamMember("ws-1", "u-2");
    expect(revoke.revokeFathomConnectionsOf).toHaveBeenCalledWith(serverMock.service, "ws-1", "u-2");
    expect(db.writesTo("calls")).toHaveLength(0);
  });

  it("si revocar el Fathom falla, salir del equipo igual quedo hecho", async () => {
    revoke.revokeFathomConnectionsOf.mockRejectedValueOnce(new Error("vault caido"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ "workspace_members:select": { data: { role: "owner" } } });
    workspaceMock.getWorkspace.mockResolvedValue({ workspace: WS, user: { id: "u-owner" }, supabase: db.client });
    expect(await removeTeamMember("ws-1", "u-2")).toEqual({ ok: true });
    spy.mockRestore();
  });

  it("a quien no es el Owner no le revoca nada", async () => {
    const db = fakeDb({ "workspace_members:select": { data: { role: "admin" } } });
    workspaceMock.getWorkspace.mockResolvedValue({ workspace: WS, user: { id: "u-admin" }, supabase: db.client });
    await removeTeamMember("ws-1", "u-2");
    expect(revoke.revokeFathomConnectionsOf).not.toHaveBeenCalled();
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
    guards.getPermissionAction.mockResolvedValue({ workspace: WS, user: { id: "u-owner" }, supabase: fakeDb().client });
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
