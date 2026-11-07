/**
 * Crear la cuenta desde una invitacion (`registerFromInvite`). Es una accion PUBLICA: la llama quien todavia no
 * tiene cuenta, solo con el id de la invitacion. Lo que se cuida:
 *  - la cuenta se crea con el email de la INVITACION (el formulario no manda ninguno);
 *  - con una invitacion que no existe, anulada, aceptada o vencida no se crea nada.
 *
 * Supabase va en memoria; Auth simulado (crear la cuenta e iniciar sesion).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => "audit-1") }));
const setActiveWorkspaceCookie = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/workspace", () => ({ getWorkspace: vi.fn(), setActiveWorkspaceCookie }));
vi.mock("@/lib/fathom/revoke", () => ({ revokeFathomConnectionsOf: vi.fn(async () => 0) })); // @plantilla-quitar(llamadas)
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: vi.fn() }));

const auth = vi.hoisted(() => ({ createUser: vi.fn(), signInWithPassword: vi.fn() }));
let db: MemoryDb;
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({ ...db.client, auth: { admin: { createUser: auth.createUser } } }),
  createClient: async () => ({ auth: { signInWithPassword: auth.signInWithPassword }, from: (t: string) => db.client.from(t as never) }),
}));

const { registerFromInvite } = await import("./team");

const ROLE_MEMBER = "role-member";
const pending = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  workspace_id: WS,
  email: "ana@ejemplo.com",
  role: "member",
  role_id: null,
  status: "pending",
  expires_at: "2099-01-01T00:00:00Z",
  ...over,
});

function seed(invites: Array<Record<string, unknown>>) {
  db = memoryDb({
    workspace_invites: invites,
    workspace_members: [],
    workspace_roles: [{ id: ROLE_MEMBER, workspace_id: WS, name: "Member", system_role: "member", permissions: { keys: [], scopes: {} } }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.createUser.mockResolvedValue({ data: { user: { id: "u-ana" } }, error: null });
  auth.signInWithPassword.mockResolvedValue({ error: null });
});

describe("registerFromInvite", () => {
  it("con una invitacion valida crea la cuenta con el email de la invitacion y la acepta", async () => {
    seed([pending()]);

    const r = await registerFromInvite("inv-1", "  Ana Perez ", "clave-segura");

    expect(r).toMatchObject({ ok: true, workspaceId: WS });
    expect(auth.createUser).toHaveBeenCalledTimes(1);
    expect(auth.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ana@ejemplo.com", password: "clave-segura", email_confirm: true, user_metadata: expect.objectContaining({ full_name: "Ana Perez", invite_id: "inv-1" }) }),
    );
    // La sesion se abre con el mismo email de la invitacion.
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "ana@ejemplo.com", password: "clave-segura" });
    expect(db.rows("workspace_members")[0]).toMatchObject({ workspace_id: WS, user_id: "u-ana", role: "member", role_id: ROLE_MEMBER });
    expect(db.rows("workspace_invites")[0]).toMatchObject({ status: "accepted", accepted_by: "u-ana" });
  });

  it("una invitacion que no existe, anulada, aceptada o vencida no crea ninguna cuenta", async () => {
    const casos: Array<[string, Array<Record<string, unknown>>]> = [
      ["no existe", []],
      ["anulada", [pending({ status: "revoked" })]],
      ["aceptada", [pending({ status: "accepted" })]],
      ["vencida", [pending({ expires_at: "2020-01-01T00:00:00Z" })]],
    ];
    for (const [nombre, invites] of casos) {
      seed(invites);
      const r = await registerFromInvite("inv-1", "Ana", "clave-segura");
      expect(r, nombre).toMatchObject({ error: expect.any(String) });
      expect(db.rows("workspace_members"), nombre).toHaveLength(0);
    }
    expect(auth.createUser).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("sin nombre o con una contraseña corta no consulta nada", async () => {
    seed([pending()]);

    expect(await registerFromInvite("inv-1", "   ", "clave-segura")).toMatchObject({ error: expect.any(String) });
    expect(await registerFromInvite("inv-1", "Ana", "123")).toMatchObject({ error: expect.any(String) });
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it("si el email ya tiene cuenta, no la pisa: pide iniciar sesion", async () => {
    seed([pending()]);
    auth.createUser.mockResolvedValue({ data: { user: null }, error: { message: "A user with this email address has already been registered" } });

    const r = await registerFromInvite("inv-1", "Ana", "clave-segura");

    expect(r).toMatchObject({ alreadyRegistered: true });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(db.rows("workspace_members")).toHaveLength(0);
  });
});
