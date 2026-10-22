/**
 * Equipo y roles (B2, F7-F11): invitar, reenviar, renovar, anular, copiar el link y aceptar.
 *
 * Supabase va en memoria y Resend simulado: ninguna prueba manda un correo de verdad.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { SYSTEM_ROLE_PERMISSIONS, type RolePermissions } from "@/lib/auth/permissions";

const WS = "ws-1";
const email = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/lib/email/send", () => email);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => "audit-1") }));
vi.mock("@/lib/audit", () => audit);
vi.mock("@/lib/workspace", () => ({ getWorkspace: vi.fn() }));
vi.mock("@/lib/fathom/revoke", () => ({ revokeFathomConnectionsOf: vi.fn(async () => 0) }));

let db: MemoryDb;
let authUser: { id: string; email: string } | null = null;
const guards = vi.hoisted(() => ({ getPermissionAction: vi.fn() }));
vi.mock("@/lib/auth/guards", () => guards);
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => db.client,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: authUser } }) }, from: (t: string) => db.client.from(t as never) }),
}));

const { inviteTeamMember, resendInvite, renewInvite, revokeInvite, copyInviteLink, acceptInvite } = await import("./team");

const ROLE = { admin: "role-admin", member: "role-member", owner: "role-owner", custom: "role-closer" };
const closerKeys = ["contacts.view", "contacts.edit"];

function seed(over: Record<string, Array<Record<string, unknown>>> = {}) {
  return memoryDb(
    {
      workspace_invites: [],
      workspace_members: [],
      workspace_roles: [
        { id: ROLE.owner, workspace_id: WS, name: "Owner", system_role: "owner", permissions: { keys: [], scopes: {} } },
        { id: ROLE.admin, workspace_id: WS, name: "Admin", system_role: "admin", permissions: { keys: [], scopes: {} } },
        { id: ROLE.member, workspace_id: WS, name: "Member", system_role: "member", permissions: { keys: [], scopes: {} } },
        { id: ROLE.custom, workspace_id: WS, name: "Closer", system_role: null, permissions: { keys: closerKeys, scopes: { leads: "own" } } },
      ],
      ...over,
    },
    { rpc: { workspace_member_profiles: () => [{ user_id: "u-owner", email: "dueno@negocio.io", full_name: "Dueña", meta_name: null, role: "owner", role_id: ROLE.owner, joined_at: "2026-01-01" }] } },
  );
}

/** Quien invita: Owner por defecto; o un rol personalizado con exactamente estas claves. */
function actor(kind: "owner" | "admin" | RolePermissions = "owner") {
  const permissions = typeof kind === "string" ? SYSTEM_ROLE_PERMISSIONS[kind] : kind;
  guards.getPermissionAction.mockImplementation(async (key: string) =>
    permissions.keys.includes(key)
      ? { workspace: { id: WS, name: "Negocio" }, user: { id: "u-actor" }, supabase: db.client, role: typeof kind === "string" ? kind : "member", roleId: typeof kind === "string" ? null : "rol-actor", permissions, can: (k: string) => permissions.keys.includes(k) }
      : null,
  );
}

const custom = (keys: string[], scopes: Partial<RolePermissions["scopes"]> = {}): RolePermissions => ({
  keys,
  scopes: { leads: "own", bookings: "own", calls: "own", sales: "own", commissions: "own", tasks: "own", ...scopes },
  channels: { mode: "custom", byChannel: {} },
});

const invites = () => db.rows("workspace_invites");

beforeEach(() => {
  vi.clearAllMocks();
  db = seed();
  authUser = null;
  email.sendTransactionalEmail.mockResolvedValue({ ok: true, id: "email-1" });
  actor("owner");
});

describe("inviteTeamMember (F7)", () => {
  it("por email con un rol personalizado: guarda role_id, role 'member' y manda UN correo", async () => {
    const r = await inviteTeamMember({ email: "  Nueva@Ejemplo.com ", roleId: ROLE.custom, delivery: "email" });

    expect(r).toMatchObject({ ok: true, emailStatus: "sent", emailError: null });
    expect(invites()).toHaveLength(1);
    expect(invites()[0]).toMatchObject({
      workspace_id: WS, email: "nueva@ejemplo.com", role: "member", role_id: ROLE.custom, delivery: "email",
      email_status: "sent", send_count: 1, status: "pending", invited_by: "u-actor",
    });
    expect(email.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(email.sendTransactionalEmail.mock.calls[0][0]).toMatchObject({ to: "nueva@ejemplo.com", kind: "team_invite" });
    // El link siempre se devuelve, en /invite/<id> (los links ya enviados siguen valiendo).
    expect((r as { inviteUrl: string }).inviteUrl).toContain(`/invite/${invites()[0].id}`);
  });

  it("solo link: NO llama a sendTransactionalEmail y devuelve el link", async () => {
    const r = await inviteTeamMember({ email: "a@b.co", roleId: ROLE.member, delivery: "link" });

    expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, emailStatus: null });
    // `send_count` queda en su default de la base (0): en memoria no hay defaults.
    expect(invites()[0]).toMatchObject({ delivery: "link", role: "member", role_id: ROLE.member });
    expect(invites()[0].send_count ?? 0).toBe(0);
    expect(invites()[0].email_status ?? null).toBeNull();
    expect((r as { inviteUrl: string }).inviteUrl).toContain("/invite/");
  });

  it("el rol Admin guarda role 'admin'", async () => {
    await inviteTeamMember({ email: "a@b.co", roleId: ROLE.admin, delivery: "link" });
    expect(invites()[0]).toMatchObject({ role: "admin", role_id: ROLE.admin });
  });

  it("si Resend falla o no esta conectado, la invitacion existe igual y queda el estado", async () => {
    email.sendTransactionalEmail.mockResolvedValueOnce({ ok: false, reason: "not_configured", error: "Resend no esta conectado" });
    const r1 = await inviteTeamMember({ email: "a@b.co", roleId: ROLE.member, delivery: "email" });
    expect(r1).toMatchObject({ ok: true, emailStatus: "not_configured" });
    expect(invites()[0].email_status).toBe("not_configured");

    email.sendTransactionalEmail.mockResolvedValueOnce({ ok: false, reason: "failed", error: "rechazado" });
    const r2 = await inviteTeamMember({ email: "c@d.co", roleId: ROLE.member, delivery: "email" });
    expect(r2).toMatchObject({ ok: true, emailStatus: "failed", emailError: "rechazado" });
    expect(invites()[1]).toMatchObject({ email_status: "failed", email_error: "rechazado" });
  });

  it("rechaza sin team.invite, sin tocar la base", async () => {
    actor(custom(["team.view"]));
    const r = await inviteTeamMember({ email: "a@b.co", roleId: ROLE.member, delivery: "link" });
    expect(r).toMatchObject({ ok: false });
    expect(invites()).toHaveLength(0);
  });

  it("ataque: un rol con team.invite invita como Admin → 'No podés dar permisos que no tenés'", async () => {
    actor(custom(["team.view", "team.invite", ...SYSTEM_ROLE_PERMISSIONS.member.keys]));
    const r = await inviteTeamMember({ email: "a@b.co", roleId: ROLE.admin, delivery: "link" });
    expect(r).toEqual({ ok: false, error: "No podés dar permisos que no tenés." });
    expect(invites()).toHaveLength(0);
    expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("ataque: invitar con un rol personalizado que tiene claves que uno no tiene", async () => {
    actor(custom(["team.invite", "contacts.view"]));
    const r = await inviteTeamMember({ email: "a@b.co", roleId: ROLE.custom, delivery: "link" });
    expect(r).toMatchObject({ ok: false, error: "No podés dar permisos que no tenés." });
    expect(invites()).toHaveLength(0);

    // Con las claves que el rol necesita, si.
    actor(custom(["team.invite", ...closerKeys]));
    expect((await inviteTeamMember({ email: "a@b.co", roleId: ROLE.custom, delivery: "link" })).ok).toBe(true);
  });

  it("nadie invita como Owner", async () => {
    const r = await inviteTeamMember({ email: "a@b.co", roleId: ROLE.owner, delivery: "link" });
    expect(r.ok).toBe(false);
    expect(invites()).toHaveLength(0);
  });

  it("si la persona ya esta en el equipo, no crea nada", async () => {
    const r = await inviteTeamMember({ email: "Dueno@Negocio.io", roleId: ROLE.member, delivery: "email" });
    expect(r).toEqual({ ok: false, error: "Esa persona ya está en el equipo" });
    expect(invites()).toHaveLength(0);
    expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("si ya hay una invitacion vigente para ese email, ofrece su link y no crea otra", async () => {
    db = seed({ workspace_invites: [{ id: "inv-1", workspace_id: WS, email: "a@b.co", status: "pending", expires_at: "2099-01-01T00:00:00Z" }] });
    actor("owner");
    const r = await inviteTeamMember({ email: "a@b.co", roleId: ROLE.member, delivery: "email" });
    expect(r).toMatchObject({ ok: false, error: "Ya hay una invitación pendiente para ese email" });
    expect((r as { existingInviteUrl?: string }).existingInviteUrl).toContain("/invite/inv-1");
    expect(invites()).toHaveLength(1);
  });

  it("una invitacion vencida no bloquea volver a invitar", async () => {
    db = seed({ workspace_invites: [{ id: "inv-viejo", workspace_id: WS, email: "a@b.co", status: "pending", expires_at: "2020-01-01T00:00:00Z" }] });
    actor("owner");
    expect((await inviteTeamMember({ email: "a@b.co", roleId: ROLE.member, delivery: "link" })).ok).toBe(true);
    expect(invites()).toHaveLength(2);
  });

  it("valida el email y el rol", async () => {
    expect((await inviteTeamMember({ email: "sin-arroba", roleId: ROLE.member, delivery: "link" })).ok).toBe(false);
    expect((await inviteTeamMember({ email: "a@b.co", roleId: "no-existe", delivery: "link" })).ok).toBe(false);
    expect((await inviteTeamMember({ email: "a@b.co", roleId: ROLE.member, delivery: "paloma" as never })).ok).toBe(false);
  });

  it("los logs no llevan emails ni links", async () => {
    const spies = (["log", "warn", "error", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    email.sendTransactionalEmail.mockResolvedValueOnce({ ok: false, reason: "failed", error: "rechazado" });
    await inviteTeamMember({ email: "secreta@ejemplo.com", roleId: ROLE.member, delivery: "email" });
    const output = spies.flatMap((s) => s.mock.calls).map((c) => JSON.stringify(c)).join("\n");
    expect(output).not.toContain("secreta@ejemplo.com");
    expect(output).not.toContain("/invite/");
    spies.forEach((s) => s.mockRestore());
  });
});

describe("pendientes (F8)", () => {
  const base = (over: Record<string, unknown> = {}) => ({
    id: "inv-1", workspace_id: WS, email: "a@b.co", role: "member", role_id: ROLE.member, status: "pending",
    expires_at: "2099-01-01T00:00:00Z", delivery: "email", send_count: 1, last_sent_at: "2020-01-01T00:00:00Z", ...over,
  });

  it("reenviar: manda el correo, suma send_count y actualiza last_sent_at", async () => {
    db = seed({ workspace_invites: [base()] });
    actor("owner");
    const r = await resendInvite("inv-1");
    expect(r).toMatchObject({ ok: true, emailStatus: "sent" });
    expect(email.sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(invites()[0]).toMatchObject({ send_count: 2, email_status: "sent", delivery: "email" });
    expect(new Date(invites()[0].last_sent_at as string).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("reenviar: rechaza si pasaron menos de 60 segundos, y no manda nada", async () => {
    db = seed({ workspace_invites: [base({ last_sent_at: new Date(Date.now() - 20_000).toISOString() })] });
    actor("owner");
    const r = await resendInvite("inv-1");
    expect(r).toMatchObject({ ok: false });
    expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
    expect(invites()[0].send_count).toBe(1);
  });

  it("reenviar: rechaza al llegar a 5 envios", async () => {
    db = seed({ workspace_invites: [base({ send_count: 5 })] });
    actor("owner");
    expect((await resendInvite("inv-1")).ok).toBe(false);
    expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("reenviar: sin team.invite no hace nada", async () => {
    db = seed({ workspace_invites: [base()] });
    actor(custom(["team.view"]));
    expect((await resendInvite("inv-1")).ok).toBe(false);
    expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("renovar: pone el vencimiento a 7 dias desde ahora, este vencida o vigente", async () => {
    db = seed({ workspace_invites: [base({ expires_at: "2020-01-01T00:00:00Z" })] });
    actor("owner");
    const r = await renewInvite("inv-1");
    expect(r.ok).toBe(true);
    const days = (new Date(invites()[0].expires_at as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it("anular es un UPDATE: la fila queda como 'revoked' con quien y cuando, no se borra", async () => {
    db = seed({ workspace_invites: [base()] });
    actor("owner");
    expect(await revokeInvite("inv-1")).toEqual({ ok: true });
    expect(invites()).toHaveLength(1);
    expect(invites()[0]).toMatchObject({ status: "revoked", revoked_by: "u-actor" });
    expect(invites()[0].revoked_at).toBeTruthy();
  });

  it("una aceptada o ya anulada no se anula ni se renueva", async () => {
    db = seed({ workspace_invites: [base({ status: "accepted" })] });
    actor("owner");
    expect((await revokeInvite("inv-1")).ok).toBe(false);
    expect((await renewInvite("inv-1")).ok).toBe(false);
    expect(invites()[0].status).toBe("accepted");
  });

  it("una invitacion de otro workspace no se toca", async () => {
    db = seed({ workspace_invites: [base({ workspace_id: "otro-ws" })] });
    actor("owner");
    expect((await revokeInvite("inv-1")).ok).toBe(false);
    expect(invites()[0].status).toBe("pending");
  });

  it("copiar el link queda en el historial (invite_link_copied)", async () => {
    db = seed({ workspace_invites: [base()] });
    actor("owner");
    const r = await copyInviteLink("inv-1");
    expect(r).toMatchObject({ ok: true });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ kind: "invite_link_copied" }) }));
  });
});

describe("aceptar (F10)", () => {
  const pending = (over: Record<string, unknown> = {}) => ({
    id: "inv-1", workspace_id: WS, email: "nueva@ejemplo.com", role: "member", role_id: ROLE.custom, status: "pending",
    expires_at: "2099-01-01T00:00:00Z", ...over,
  });

  beforeEach(() => {
    authUser = { id: "u-nueva", email: "nueva@ejemplo.com" };
  });

  it("con un rol personalizado: crea el miembro con ese role_id y role 'member'", async () => {
    db = seed({ workspace_invites: [pending()] });
    const r = await acceptInvite("inv-1");
    expect(r).toMatchObject({ ok: true, workspaceId: WS });
    expect(db.rows("workspace_members")[0]).toMatchObject({ workspace_id: WS, user_id: "u-nueva", role: "member", role_id: ROLE.custom });
    expect(invites()[0]).toMatchObject({ status: "accepted", accepted_by: "u-nueva" });
    expect(invites()[0].accepted_at).toBeTruthy();
  });

  it("si el rol se borro (role_id quedo en NULL), cae al Member de sistema", async () => {
    db = seed({ workspace_invites: [pending({ role_id: null })] });
    await acceptInvite("inv-1");
    expect(db.rows("workspace_members")[0]).toMatchObject({ role: "member", role_id: ROLE.member });
  });

  it("si apunta a un rol que ya no existe, tambien cae al Member de sistema", async () => {
    db = seed({ workspace_invites: [pending({ role_id: "rol-fantasma" })] });
    await acceptInvite("inv-1");
    expect(db.rows("workspace_members")[0]).toMatchObject({ role: "member", role_id: ROLE.member });
  });

  it("una invitacion vieja de Admin (sin role_id) entra con el rol de sistema Admin", async () => {
    db = seed({ workspace_invites: [pending({ role: "admin", role_id: null })] });
    await acceptInvite("inv-1");
    expect(db.rows("workspace_members")[0]).toMatchObject({ role: "admin", role_id: ROLE.admin });
  });

  it("anulada, aceptada o vencida: 'Esta invitación ya no es válida'", async () => {
    for (const over of [{ status: "revoked" }, { status: "accepted" }]) {
      db = seed({ workspace_invites: [pending(over)] });
      expect(await acceptInvite("inv-1")).toEqual({ error: "Esta invitación ya no es válida" });
      expect(db.rows("workspace_members")).toHaveLength(0);
    }
    db = seed({ workspace_invites: [pending({ expires_at: "2020-01-01T00:00:00Z" })] });
    const r = await acceptInvite("inv-1");
    expect((r as { error: string }).error).toContain("Esta invitación ya no es válida");
    expect((r as { error: string }).error).toContain("renueve");
  });

  it("solo con el email de la invitacion", async () => {
    db = seed({ workspace_invites: [pending()] });
    authUser = { id: "u-otro", email: "otro@ejemplo.com" };
    expect(await acceptInvite("inv-1")).toEqual({ error: "Esta invitación se mandó a otro email" });
    expect(db.rows("workspace_members")).toHaveLength(0);
  });
});
