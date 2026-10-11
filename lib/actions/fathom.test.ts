import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const guards = vi.hoisted(() => ({ getMemberAction: vi.fn(), getPermissionAction: vi.fn() }));
vi.mock("@/lib/auth/guards", () => guards);
const server = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => server.service }));
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => "a1") }));
vi.mock("@/lib/audit", () => audit);
const vault = vi.hoisted(() => ({ stored: new Map<string, string>(), deleted: [] as string[], fail: false }));
vi.mock("@/lib/vault", async (orig) => {
  const actual = await orig<typeof import("@/lib/vault")>();
  return {
    ...actual,
    storeSecret: async (_s: unknown, _ws: string, name: string, value: string) => { if (vault.fail) return { ok: false, error: "x" }; vault.stored.set(name, value); return { ok: true }; },
    deleteSecret: async (_s: unknown, _ws: string, name: string) => { vault.deleted.push(name); return { ok: true, deleted: true }; },
  };
});
const queue = vi.hoisted(() => ({ queueFathomSyncNow: vi.fn() }));
vi.mock("@/lib/fathom/queue", () => queue);

import { disconnectFathom, saveFathomApp, syncFathomNow, validateFathomApp } from "./fathom";

const WS = "ws-1";
const ME = { workspace: { id: WS }, user: { id: "user-ana" }, supabase: fakeDb().client };

beforeEach(() => {
  vi.clearAllMocks();
  vault.stored.clear(); vault.deleted.length = 0; vault.fail = false;
  guards.getMemberAction.mockResolvedValue(ME);
  guards.getPermissionAction.mockResolvedValue(ME);
});

describe("saveFathomApp", () => {
  it("guarda el Client ID y el Secret en Vault, audita SIN los valores y no los devuelve", async () => {
    server.service = fakeDb().client;
    const r = await saveFathomApp({ clientId: " cid-123456 ", clientSecret: "sec-ABCDEFGH" });
    expect(r).toEqual({ ok: true });
    expect(vault.stored.get("fathom_client_id")).toBe("cid-123456");
    expect(vault.stored.get("fathom_client_secret")).toBe("sec-ABCDEFGH");
    const logged = JSON.stringify(audit.logAudit.mock.calls);
    expect(logged).not.toContain("sec-ABCDEFGH");
    expect(logged).not.toContain("cid-123456");
  });

  it("sin integrations.manage responde sin permiso", async () => {
    guards.getPermissionAction.mockResolvedValue(null);
    const r = await saveFathomApp({ clientId: "cid-123456", clientSecret: "sec-ABCDEFGH" });
    expect(r.ok).toBe(false);
    expect(vault.stored.size).toBe(0);
  });

  it("rechaza valores que no parecen claves", () => {
    expect(validateFathomApp({ clientId: "corto", clientSecret: "sec-ABCDEFGH" })).toContain("Client ID");
    expect(validateFathomApp({ clientId: "cid-123456", clientSecret: "tiene espacios x" })).toContain("Secret");
    expect(validateFathomApp({ clientId: "cid-123456", clientSecret: "sec-ABCDEFGH" })).toBeNull();
  });

  it("si Vault falla, no dice que se guardo", async () => {
    server.service = fakeDb().client;
    vault.fail = true;
    expect((await saveFathomApp({ clientId: "cid-123456", clientSecret: "sec-ABCDEFGH" })).ok).toBe(false);
  });
});

describe("disconnectFathom", () => {
  const row = { id: "c1", workspace_id: WS, user_id: "user-ana", vault_secret_prefix: "oauth_fathom_c1", account_label: "ana@x.io" };

  it("borra los dos tokens de Vault y deja la conexion revocada (las llamadas no se tocan)", async () => {
    const db = fakeDb({ "oauth_connections:select": { data: row } });
    server.service = db.client;
    const r = await disconnectFathom("c1");
    expect(r).toEqual({ ok: true });
    expect(vault.deleted.sort()).toEqual(["oauth_fathom_c1_access_token", "oauth_fathom_c1_refresh_token"]);
    expect(db.writesTo("oauth_connections")[0].values).toMatchObject({ status: "revoked" });
    expect(db.writesTo("calls")).toHaveLength(0);
  });

  it("no puede desconectar la conexion de otra persona", async () => {
    const db = fakeDb({ "oauth_connections:select": { data: { ...row, user_id: "user-beto" } } });
    server.service = db.client;
    const r = await disconnectFathom("c1");
    expect(r.ok).toBe(false);
    expect(vault.deleted).toHaveLength(0);
    expect(db.writes()).toHaveLength(0);
  });

  it("una conexion que no existe: no la encuentra", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: null } }).client;
    expect((await disconnectFathom("nada")).ok).toBe(false);
  });
});

describe("syncFathomNow", () => {
  it("sin conexion activa: rechaza", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: null } }).client;
    const r = await syncFathomNow();
    expect(r.ok).toBe(false);
    expect(queue.queueFathomSyncNow).not.toHaveBeenCalled();
  });

  it("encola el job de SU conexion", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: { id: "c1", status: "active" } } }, { bump_rate_limit: { data: 1 as never } }).client;
    queue.queueFathomSyncNow.mockResolvedValue({ queued: true });
    const r = await syncFathomNow();
    expect(r.ok).toBe(true);
    expect(queue.queueFathomSyncNow).toHaveBeenCalledWith(expect.anything(), "c1", expect.any(Date));
  });

  it("la segunda vez seguida dice que ya se esta sincronizando", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: { id: "c1", status: "active" } } }, { bump_rate_limit: { data: 1 as never } }).client;
    queue.queueFathomSyncNow.mockResolvedValue({ queued: false, reason: "already" });
    const r = await syncFathomNow();
    expect(r).toEqual({ ok: true, message: "Ya se está sincronizando" });
  });

  it("mas de una vez por minuto se frena", async () => {
    server.service = fakeDb({ "oauth_connections:select": { data: { id: "c1", status: "active" } } }, { bump_rate_limit: { data: 2 as never } }).client;
    const r = await syncFathomNow();
    expect(r.ok).toBe(false);
    expect(queue.queueFathomSyncNow).not.toHaveBeenCalled();
  });
});
