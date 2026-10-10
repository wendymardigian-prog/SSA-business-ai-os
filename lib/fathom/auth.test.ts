import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const vault = vi.hoisted(() => ({ store: new Map<string, string>(), failStore: false }));
vi.mock("@/lib/vault", async (orig) => {
  const actual = await orig<typeof import("@/lib/vault")>();
  return {
    ...actual,
    readSecret: async (_s: unknown, ws: string, name: string) => vault.store.get(`${ws}:${name}`) ?? null,
    storeSecret: async (_s: unknown, ws: string, name: string, value: string) => {
      if (vault.failStore) return { ok: false, error: "vault caido" };
      vault.store.set(`${ws}:${name}`, value);
      return { ok: true };
    },
  };
});

import { getFathomAccessToken, resetFathomTokenCache } from "./auth";
import { FathomError } from "./errors";

const WS = "ws-1";
const CONN = "11111111-1111-4111-8111-111111111111";
const PREFIX = "oauth_fathom_c1";
const NOW = new Date("2026-10-10T18:00:00.000Z");
const SECRETS = { access: "ACCESS-VIEJO-SECRETO", refresh: "REFRESH-VIEJO-SECRETO", clientId: "CLIENT-ID", clientSecret: "CLIENT-SECRETO" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function makeWorld(over: { expiresAt?: string | null; status?: string } = {}) {
  const row = {
    id: CONN, workspace_id: WS, user_id: "user-ana", status: over.status ?? "active", vault_secret_prefix: PREFIX,
    token_expires_at: over.expiresAt === undefined ? "2026-10-10T17:00:00.000Z" : over.expiresAt, account_label: "ana@negocio.io",
  };
  let locked = false;
  const notifications: Array<Record<string, unknown>> = [];
  const db = fakeDb(
    {
      "oauth_connections:select": () => ({ data: { ...row } }),
      "oauth_connections:update": (call) => { Object.assign(row, call.values); return { data: null }; },
      "notifications:select": () => ({ data: notifications.filter((n) => n.read_at == null) }),
      "notifications:insert": (call) => { notifications.push(call.values as Record<string, unknown>); return { data: null }; },
    },
    {
      claim_oauth_refresh: () => { if (locked) return { data: false }; locked = true; return { data: true }; },
      release_oauth_refresh: () => { locked = false; return { data: null }; },
    },
  );
  vault.store.set(`${WS}:${PREFIX}_access_token`, SECRETS.access);
  vault.store.set(`${WS}:${PREFIX}_refresh_token`, SECRETS.refresh);
  vault.store.set(`${WS}:fathom_client_id`, SECRETS.clientId);
  vault.store.set(`${WS}:fathom_client_secret`, SECRETS.clientSecret);
  return { row, db, notifications, isLocked: () => locked };
}

const sleep = () => new Promise<void>((r) => setTimeout(r, 5));

beforeEach(() => { resetFathomTokenCache(); vault.store.clear(); vault.failStore = false; });
afterEach(() => vi.restoreAllMocks());

describe("getFathomAccessToken", () => {
  it("con un token vencido renueva, guarda el refresh NUEVO en Vault y devuelve el access nuevo", async () => {
    const w = makeWorld();
    const fetchImpl = vi.fn(async () => json({ access_token: "ACCESS-NUEVO", refresh_token: "REFRESH-NUEVO", expires_in: 3600 }));
    const token = await getFathomAccessToken({ supabase: w.db.client, fetchImpl: fetchImpl as never, now: () => NOW, sleep }, CONN);
    expect(token).toBe("ACCESS-NUEVO");
    expect(vault.store.get(`${WS}:${PREFIX}_refresh_token`)).toBe("REFRESH-NUEVO");
    expect(vault.store.get(`${WS}:${PREFIX}_access_token`)).toBe("ACCESS-NUEVO");
    expect(w.row.token_expires_at).toBe(new Date(NOW.getTime() + 3600_000).toISOString());
    expect(w.isLocked()).toBe(false); // libero el candado
  });

  it("si Fathom no devuelve un refresh nuevo, conserva el anterior", async () => {
    const w = makeWorld();
    const fetchImpl = vi.fn(async () => json({ access_token: "ACCESS-NUEVO", expires_in: 3600 }));
    await getFathomAccessToken({ supabase: w.db.client, fetchImpl: fetchImpl as never, now: () => NOW, sleep }, CONN);
    expect(vault.store.get(`${WS}:${PREFIX}_refresh_token`)).toBe(SECRETS.refresh);
  });

  it("guarda el refresh nuevo ANTES que el access token", async () => {
    const w = makeWorld();
    const order: string[] = [];
    const real = vault.store.set.bind(vault.store);
    vault.store.set = ((k: string, v: string) => { order.push(k.split(":")[1]); return real(k, v); }) as never;
    await getFathomAccessToken({ supabase: w.db.client, fetchImpl: (async () => json({ access_token: "A2", refresh_token: "R2", expires_in: 60 })) as never, now: () => NOW, sleep }, CONN);
    const writes = order.slice(-2);
    expect(writes).toEqual([`${PREFIX}_refresh_token`, `${PREFIX}_access_token`]);
  });

  it("un token vigente se usa sin llamar a Fathom", async () => {
    const w = makeWorld({ expiresAt: "2026-10-10T19:00:00.000Z" });
    const fetchImpl = vi.fn();
    const token = await getFathomAccessToken({ supabase: w.db.client, fetchImpl: fetchImpl as never, now: () => NOW, sleep }, CONN);
    expect(token).toBe(SECRETS.access);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("dos pedidos simultaneos con el token vencido llaman al refresh UNA sola vez", async () => {
    const w = makeWorld();
    let calls = 0;
    const fetchImpl = vi.fn(async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return json({ access_token: "ACCESS-NUEVO", refresh_token: "REFRESH-NUEVO", expires_in: 3600 }); });
    const deps = { supabase: w.db.client, fetchImpl: fetchImpl as never, now: () => NOW, sleep };
    const [a, b] = await Promise.all([getFathomAccessToken(deps, CONN), getFathomAccessToken(deps, CONN)]);
    expect(calls).toBe(1);
    expect(a).toBe("ACCESS-NUEVO");
    expect(b).toBe("ACCESS-NUEVO");
  });

  it("si otro proceso nunca termina de renovar, falla como 'temporary' sin tocar la conexion", async () => {
    const w = makeWorld();
    const stuck = fakeDb({ "oauth_connections:select": () => ({ data: { ...w.row } }) }, { claim_oauth_refresh: () => ({ data: false }), release_oauth_refresh: () => ({ data: null }) });
    const err = await getFathomAccessToken({ supabase: stuck.client, fetchImpl: vi.fn() as never, now: () => NOW, sleep: () => Promise.resolve() }, CONN).catch((e) => e);
    expect(err).toBeInstanceOf(FathomError);
    expect(err.kind).toBe("temporary");
    expect(stuck.writes()).toHaveLength(0);
  });

  it("un 400 invalid_grant deja la conexion en error y crea UNA notificacion para ESA persona", async () => {
    const w = makeWorld();
    const fetchImpl = vi.fn(async () => json({ error: "invalid_grant" }, 400));
    const deps = { supabase: w.db.client, fetchImpl: fetchImpl as never, now: () => NOW, sleep };
    const err = await getFathomAccessToken(deps, CONN).catch((e) => e);
    expect(err.kind).toBe("permanent");
    expect(w.row.status).toBe("error");
    expect(String(w.row.last_error)).toContain("reconectar");
    expect(w.notifications).toHaveLength(1);
    expect(w.notifications[0]).toMatchObject({ type: "fathom_connection_error", recipient_id: "user-ana", entity_type: "fathom", entity_id: CONN });
    expect(w.isLocked()).toBe(false);
  });

  it("un 503 deja la conexion activa y el error es 'temporary'", async () => {
    const w = makeWorld();
    const err = await getFathomAccessToken({ supabase: w.db.client, fetchImpl: (async () => json({}, 503)) as never, now: () => NOW, sleep }, CONN).catch((e) => e);
    expect(err.kind).toBe("temporary");
    expect(w.row.status).toBe("active");
    expect(w.notifications).toHaveLength(0);
  });

  it("un error de red tambien es 'temporary'", async () => {
    const w = makeWorld();
    const err = await getFathomAccessToken({ supabase: w.db.client, fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as never, now: () => NOW, sleep }, CONN).catch((e) => e);
    expect(err.kind).toBe("temporary");
    expect(w.row.status).toBe("active");
  });

  it("si no se puede guardar el refresh nuevo: error, aviso a la persona y log sin el token", async () => {
    const w = makeWorld();
    vault.failStore = true;
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    const err = await getFathomAccessToken({ supabase: w.db.client, fetchImpl: (async () => json({ access_token: "ACCESS-NUEVO", refresh_token: "REFRESH-NUEVO", expires_in: 60 })) as never, now: () => NOW, sleep }, CONN).catch((e) => e);
    expect(err.kind).toBe("permanent");
    expect(w.row.status).toBe("error");
    expect(w.row.last_error).toBe("no se pudo guardar el token nuevo");
    expect(w.notifications).toHaveLength(1);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l).not.toContain("REFRESH-NUEVO");
  });

  it("una conexion en error o revocada no intenta nada", async () => {
    const w = makeWorld({ status: "revoked" });
    const fetchImpl = vi.fn();
    const err = await getFathomAccessToken({ supabase: w.db.client, fetchImpl: fetchImpl as never, now: () => NOW, sleep }, CONN).catch((e) => e);
    expect(err.kind).toBe("permanent");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("faltan el Client ID y el Secret: 'temporary' (es del admin), la conexion no se rompe", async () => {
    const w = makeWorld();
    vault.store.delete(`${WS}:fathom_client_id`);
    const err = await getFathomAccessToken({ supabase: w.db.client, fetchImpl: vi.fn() as never, now: () => NOW, sleep }, CONN).catch((e) => e);
    expect(err.kind).toBe("temporary");
    expect(w.row.status).toBe("active");
  });

  it("NINGUN mensaje de error ni log lleva un token", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    for (const status of [400, 503]) {
      resetFathomTokenCache();
      const w = makeWorld();
      const err = await getFathomAccessToken({ supabase: w.db.client, fetchImpl: (async () => json({ error: "x", leak: SECRETS.refresh }, status)) as never, now: () => NOW, sleep }, CONN).catch((e) => e);
      const everything = [String(err.message), String(w.row.last_error ?? ""), ...logs, ...w.notifications.map((n) => JSON.stringify(n))].join("|");
      for (const secret of Object.values(SECRETS)) expect(everything).not.toContain(secret);
    }
  });
});
