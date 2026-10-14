/**
 * Equipo y roles (B3, F13-F15): guardado automatico (`patchRole`), crear con la regla de "no podes dar
 * lo que no tenes" y ver la lista con `roles.view`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { SYSTEM_ROLE_PERMISSIONS, type RolePermissions } from "@/lib/auth/permissions";

const WS = "ws-1";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: MemoryDb;
const audit = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock("@/lib/audit", () => audit);
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
const guards = vi.hoisted(() => ({ getPermissionAction: vi.fn(), getAnyPermissionAction: vi.fn() }));
vi.mock("@/lib/auth/guards", () => guards);

const { patchRole, createRole, listRoles, deleteRole } = await import("./roles");

const perms = (keys: string[], scopes: Partial<RolePermissions["scopes"]> = {}): RolePermissions => ({
  keys,
  scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own", sales: "own", tasks: "own", ...scopes },
});

function actor(kind: "owner" | "admin" | RolePermissions, roleId: string | null = null) {
  const permissions = typeof kind === "string" ? SYSTEM_ROLE_PERMISSIONS[kind] : kind;
  const ctx = {
    workspace: { id: WS },
    user: { id: "u-actor" },
    supabase: db.client,
    role: typeof kind === "string" ? kind : "member",
    roleId,
    permissions,
    can: (k: string) => permissions.keys.includes(k),
  };
  guards.getPermissionAction.mockImplementation(async (key: string) => (permissions.keys.includes(key) ? ctx : null));
  guards.getAnyPermissionAction.mockImplementation(async (keys: string[]) => (keys.some((k) => permissions.keys.includes(k)) ? ctx : null));
}

const roleRow = (over: Record<string, unknown> = {}) => ({
  id: "rol-1", workspace_id: WS, name: "Closer", description: null, system_role: null,
  permissions: { keys: ["contacts.view"], scopes: { leads: "own", conversations: "own" } }, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db = memoryDb(
    {
      workspace_roles: [roleRow(), roleRow({ id: "rol-2", name: "Otro" }), roleRow({ id: "sys-member", name: "Member", system_role: "member", permissions: { keys: [], scopes: {} } })],
      workspace_members: [{ workspace_id: WS, user_id: "u-1", role_id: "rol-1" }, { workspace_id: WS, user_id: "u-2", role_id: "rol-1" }],
      audit_log: [],
    },
    { unique: { workspace_roles: (a, b) => a.workspace_id === b.workspace_id && String(a.name).toLowerCase() === String(b.name).toLowerCase() } },
  );
  // El historial: lo que escribe logAudit queda en la tabla, como en la base.
  audit.logAudit.mockImplementation(async (args: { workspaceId: string; entityType: string; entityId: string; action: string; metadata: unknown; performedBy: string }) => {
    db.rows("audit_log").push({ id: `a-${db.rows("audit_log").length + 1}`, workspace_id: args.workspaceId, entity_type: args.entityType, entity_id: args.entityId, action: args.action, metadata: args.metadata, performed_by: args.performedBy, performed_at: new Date().toISOString() });
    return "a";
  });
  actor("owner");
});

const stored = (id = "rol-1") => db.rows("workspace_roles").find((r) => r.id === id)!;

describe("patchRole (F13)", () => {
  it("agrega una clave y devuelve el rol resultante, con cuanta gente lo tiene", async () => {
    const r = await patchRole("rol-1", { addKeys: ["flows.view"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.role.permissions.keys.sort()).toEqual(["contacts.view", "flows.view"]);
    expect(r.data.role.members).toBe(2);
    expect((stored().permissions as RolePermissions).keys.sort()).toEqual(["contacts.view", "flows.view"]);
  });

  it("aplica las correcciones automaticas: responder agrega ver; sacar ver saca lo que dependia", async () => {
    const a = await patchRole("rol-1", { addKeys: ["inbox.whatsapp.reply"] });
    expect(a.ok && a.data.role.permissions.keys).toContain("inbox.whatsapp.view");
    const b = await patchRole("rol-1", { addKeys: ["contacts.edit"] });
    expect(b.ok).toBe(true);
    const c = await patchRole("rol-1", { removeKeys: ["contacts.view"] });
    expect(c.ok && c.data.role.permissions.keys).not.toContain("contacts.edit");
  });

  it("cambia un alcance", async () => {
    const r = await patchRole("rol-1", { scopes: { leads: "all" } });
    expect(r.ok && r.data.role.permissions.scopes.leads).toBe("all");
  });

  it("nombre vacio o repetido: devuelve el error del CAMPO y no guarda nada", async () => {
    const vacio = await patchRole("rol-1", { name: " " });
    expect(vacio).toMatchObject({ ok: false, field: "name" });
    const repetido = await patchRole("rol-1", { name: "otro" });
    expect(repetido).toMatchObject({ ok: false, field: "name" });
    expect(stored().name).toBe("Closer");
  });

  it("un rol de sistema no se edita", async () => {
    expect(await patchRole("sys-member", { addKeys: ["contacts.view"] })).toMatchObject({ ok: false });
  });

  it("sin roles.manage no hace nada", async () => {
    actor(perms(["roles.view"]));
    expect((await patchRole("rol-1", { addKeys: ["flows.view"] })).ok).toBe(false);
    expect((stored().permissions as RolePermissions).keys).toEqual(["contacts.view"]);
  });

  it("ataque: un rol con roles.manage le agrega a otro rol una clave que NO tiene", async () => {
    actor(perms(["roles.manage", "contacts.view"]), "mi-rol");
    const r = await patchRole("rol-1", { addKeys: ["flows.publish"] });
    expect(r).toEqual({ ok: false, error: "No podés dar permisos que no tenés.", field: "permissions" });
    expect((stored().permissions as RolePermissions).keys).toEqual(["contacts.view"]);
    // Una que SI tiene, la agrega.
    expect((await patchRole("rol-1", { addKeys: ["contacts.view"] })).ok).toBe(true);
  });

  it("ataque: un rol con roles.manage sube un alcance mas ancho que el suyo", async () => {
    actor(perms(["roles.manage", "contacts.view"], { leads: "own" }), "mi-rol");
    expect(await patchRole("rol-1", { scopes: { leads: "all" } })).toMatchObject({ ok: false, field: "permissions" });
    expect((stored().permissions as RolePermissions).scopes.leads).toBe("own");
  });

  it("ataque: un rol con roles.manage edita su propio rol", async () => {
    actor(perms(["roles.manage", "contacts.view", "flows.view"]), "rol-1");
    expect(await patchRole("rol-1", { addKeys: ["flows.view"] })).toMatchObject({ ok: false, error: "No podés editar el rol que tenés asignado." });
  });

  it("sacar permisos de un rol que tiene claves que uno no tiene, esta permitido", async () => {
    db.rows("workspace_roles")[1].permissions = { keys: ["contacts.view", "contacts.delete"], scopes: {} };
    actor(perms(["roles.manage", "contacts.view"]), "mi-rol");
    const r = await patchRole("rol-2", { removeKeys: ["contacts.delete"] });
    expect(r.ok).toBe(true);
  });
});

describe("auditoria agrupada por sesion de edicion (F13)", () => {
  it("diez tildes seguidos de la misma persona dejan UNA fila, con lo agregado y lo quitado", async () => {
    await patchRole("rol-1", { addKeys: ["flows.view"] });
    await patchRole("rol-1", { addKeys: ["social.view"] });
    await patchRole("rol-1", { removeKeys: ["contacts.view"] });
    await patchRole("rol-1", { addKeys: ["tasks.view"] });
    await patchRole("rol-1", { removeKeys: ["social.view"] }); // agregado y quitado en la sesion: se cancela

    expect(db.rows("audit_log")).toHaveLength(1);
    const meta = db.rows("audit_log")[0].metadata as { kind: string; added_keys: string[]; removed_keys: string[]; changes: number };
    expect(meta.kind).toBe("role_updated");
    expect(meta.added_keys).toEqual(["flows.view", "tasks.view"]);
    expect(meta.removed_keys).toEqual(["contacts.view"]);
    expect(meta.changes).toBe(5);
  });

  it("pasados los 10 minutos, abre una fila nueva", async () => {
    await patchRole("rol-1", { addKeys: ["flows.view"] });
    db.rows("audit_log")[0].performed_at = new Date(Date.now() - 11 * 60_000).toISOString();
    await patchRole("rol-1", { addKeys: ["social.view"] });
    expect(db.rows("audit_log")).toHaveLength(2);
  });

  it("otra persona (u otro rol) abre su propia fila", async () => {
    await patchRole("rol-1", { addKeys: ["flows.view"] });
    await patchRole("rol-2", { addKeys: ["flows.view"] });
    expect(db.rows("audit_log")).toHaveLength(2);
  });

  it("un cambio que no cambia nada no deja fila", async () => {
    await patchRole("rol-1", { addKeys: ["contacts.view"] });
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});

describe("createRole (F14) y listRoles (F15)", () => {
  it("un Admin crea un rol con cualquier clave y recibe el rol creado", async () => {
    const r = await createRole({ name: "Setter", keys: ["contacts.view", "contacts.assign"], leadsScope: "own_unassigned" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.role).toMatchObject({ name: "Setter", members: 0, systemRole: null });
  });

  it("ataque: un rol con roles.manage se arma un rol con claves que no tiene", async () => {
    actor(perms(["roles.manage", "contacts.view"]), "mi-rol");
    expect(await createRole({ name: "Poderoso", keys: ["contacts.view", "team.invite"] })).toMatchObject({ ok: false, error: "No podés dar permisos que no tenés." });
    expect(db.rows("workspace_roles").some((r) => r.name === "Poderoso")).toBe(false);
    expect((await createRole({ name: "Parecido", keys: ["contacts.view"] })).ok).toBe(true);
  });

  it("roles.view ve la lista pero no edita; sin ninguna de las dos, no entra", async () => {
    actor(perms(["roles.view"]));
    const r = await listRoles();
    expect(r.ok && r.data.canManage).toBe(false);
    expect((await patchRole("rol-1", { addKeys: ["flows.view"] })).ok).toBe(false);
    expect((await deleteRole("rol-2")).ok).toBe(false);

    actor(perms(["contacts.view"]));
    expect((await listRoles()).ok).toBe(false);

    actor("admin");
    const admin = await listRoles();
    expect(admin.ok && admin.data.canManage).toBe(true);
  });

  it("la lista muestra los permisos reales de un rol de sistema, no la fila vacia", async () => {
    const r = await listRoles();
    if (!r.ok) throw new Error("listRoles fallo");
    const member = r.data.roles.find((x) => x.systemRole === "member")!;
    expect(member.permissions.keys).toHaveLength(27);
  });
});
