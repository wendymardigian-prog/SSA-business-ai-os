/**
 * El nucleo de la tarjeta Resend (R2): conectar el webhook guarda el secreto en Vault y el estado en el config de
 * `resend`; el plan B guarda un secreto pegado; "Probar" solo lee. Resend y Vault simulados.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-db";
import { checkResendLive, clearWebhookSecret, connectWebhookForWorkspace, saveWebhookSecret } from "./resend-connection";
import { SECRET_NAMES } from "@/lib/secret-names";

const WS = "11111111-1111-1111-1111-111111111111";
const KEY = "re_key_que_nunca_sale_de_aca_123456";
const SIGNING = `whsec_${Buffer.from("el-secreto-del-webhook-de-resend").toString("base64")}`;
const RECEIVER = "https://app.negocio.test/api/webhooks/resend-inbound";

const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalUrl;
});

function world(opts: { config?: Record<string, unknown>; key?: string | null; storedNames?: string[] } = {}) {
  let config = { from_email: "hola@negocio.test", ...(opts.config ?? {}) };
  const stored: Record<string, string> = {};
  const db: FakeDb = fakeDb(
    {
      "integration_configs:select": () => ({ data: { config, is_active: true, last_event_at: null } }),
      "integration_configs:update": (call) => {
        config = (call.values as { config: typeof config }).config;
        return { data: null };
      },
    },
    {
      read_secret: (args) => ({ data: (args as { secret_name: string }).secret_name === SECRET_NAMES.resendApiKey ? (opts.key === undefined ? KEY : opts.key) : null }),
      store_secret: (args) => {
        const a = args as { secret_name: string; secret_value: string };
        stored[a.secret_name] = a.secret_value;
        return { data: "id" };
      },
      delete_secret: () => ({ data: true }),
      list_secret_names: () => ({ data: opts.storedNames ?? [] }),
    },
  );
  return { db, stored, config: () => config };
}

function resendApi(handler: (method: string, path: string, body: unknown) => [number, unknown]) {
  const calls: Array<{ method: string; path: string; auth: string | null }> = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
    const [status, payload] = handler(method, url.pathname, init?.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.negocio.test";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("connectWebhookForWorkspace", () => {
  it("crea el webhook con ?w= del negocio, guarda el secreto en Vault y el estado en el config", async () => {
    const w = world();
    const api = resendApi((method, path) => {
      if (method === "GET" && path === "/webhooks") return [200, { data: [] }];
      if (method === "POST") return [200, { id: "wh_1", signing_secret: SIGNING }];
      return [500, {}];
    });
    const res = await connectWebhookForWorkspace({ service: w.db.client, workspaceId: WS, fetchImpl: api.fetchImpl, now: new Date("2026-11-02T12:00:00Z") });
    expect(res).toEqual({ ok: true, action: "created", needsSecret: false, disabled: false });
    expect(w.stored).toEqual({ [SECRET_NAMES.resendWebhookSecret]: SIGNING });
    expect(w.config()).toMatchObject({
      from_email: "hola@negocio.test",
      access: "full",
      webhook_id: "wh_1",
      webhook_events: "email.received,email.bounced,email.complained",
      webhook_connected_at: "2026-11-02T12:00:00.000Z",
      webhook_secret_saved_at: "2026-11-02T12:00:00.000Z",
    });
    expect(w.config()).not.toHaveProperty("webhook_needs_secret");
    // Nada del secreto ni de la key en el config.
    expect(JSON.stringify(w.config())).not.toContain(SIGNING);
    expect(JSON.stringify(w.config())).not.toContain(KEY);
  });

  it("adopta uno creado a mano sin secreto devuelto: queda `webhook_needs_secret` y no se guarda nada en Vault", async () => {
    const w = world();
    const api = resendApi((method, path) => {
      if (method === "GET" && path === "/webhooks") return [200, { data: [{ id: "wh_mano", endpoint: RECEIVER, events: ["email.bounced"], status: "enabled" }] }];
      if (method === "PATCH") return [200, { id: "wh_mano" }];
      if (method === "GET" && path === "/webhooks/wh_mano") return [200, { id: "wh_mano", endpoint: RECEIVER, events: [] }];
      return [500, {}];
    });
    const res = await connectWebhookForWorkspace({ service: w.db.client, workspaceId: WS, fetchImpl: api.fetchImpl });
    expect(res).toMatchObject({ ok: true, action: "adopted", needsSecret: true });
    expect(w.stored).toEqual({});
    expect(w.config()).toMatchObject({ webhook_id: "wh_mano", webhook_needs_secret: "true" });
  });

  it("sin secreto devuelto pero con uno ya pegado antes: no pide pegarlo de nuevo", async () => {
    const w = world({ storedNames: [SECRET_NAMES.resendWebhookSecret] });
    const api = resendApi((method, path) => {
      if (method === "GET" && path === "/webhooks") return [200, { data: [{ id: "wh_1", endpoint: `${RECEIVER}?w=${WS}`, events: ["email.received", "email.bounced", "email.complained"] }] }];
      if (method === "GET") return [200, { id: "wh_1" }];
      return [500, {}];
    });
    expect(await connectWebhookForWorkspace({ service: w.db.client, workspaceId: WS, fetchImpl: api.fetchImpl })).toMatchObject({ ok: true, needsSecret: false });
  });

  it("key de solo envio: no conecta, marca el acceso y dice como seguir a mano", async () => {
    const w = world();
    const api = resendApi(() => [401, { name: "restricted_api_key" }]);
    const res = await connectWebhookForWorkspace({ service: w.db.client, workspaceId: WS, fetchImpl: api.fetchImpl });
    expect(res).toMatchObject({ ok: false, reason: "restricted" });
    expect(w.config()).toMatchObject({ access: "sending" });
    expect(api.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("sin API key: no llama a Resend", async () => {
    const w = world({ key: null });
    const api = resendApi(() => [200, {}]);
    expect(await connectWebhookForWorkspace({ service: w.db.client, workspaceId: WS, fetchImpl: api.fetchImpl })).toMatchObject({ ok: false, reason: "no_key" });
    expect(api.calls).toEqual([]);
  });

  it("con la app en localhost: se niega (Resend nunca llegaria) y no llama a nadie", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const w = world();
    const api = resendApi(() => [200, {}]);
    expect(await connectWebhookForWorkspace({ service: w.db.client, workspaceId: WS, fetchImpl: api.fetchImpl })).toMatchObject({ ok: false, reason: "local_url" });
    expect(api.calls).toEqual([]);
  });

  it("el error que vuelve nunca trae la key", async () => {
    const w = world();
    const api = resendApi(() => [401, { name: "validation_error", message: KEY }]);
    const res = await connectWebhookForWorkspace({ service: w.db.client, workspaceId: WS, fetchImpl: api.fetchImpl });
    expect(JSON.stringify(res)).not.toContain(KEY);
  });
});

describe("plan B: el secreto pegado a mano", () => {
  it("guarda un whsec_ valido en Vault y saca el 'falta el secreto'", async () => {
    const w = world({ config: { webhook_needs_secret: "true" } });
    expect(await saveWebhookSecret({ service: w.db.client, workspaceId: WS, secret: `  ${SIGNING}  ` })).toEqual({ ok: true });
    expect(w.stored).toEqual({ [SECRET_NAMES.resendWebhookSecret]: SIGNING });
    expect(w.config()).not.toHaveProperty("webhook_needs_secret");
    expect(w.config()).toHaveProperty("webhook_secret_saved_at");
  });

  it("rechaza algo que no es un Signing secret (por ejemplo, la API key pegada por error)", async () => {
    const w = world();
    const res = await saveWebhookSecret({ service: w.db.client, workspaceId: WS, secret: KEY });
    expect(res.ok).toBe(false);
    expect(w.stored).toEqual({});
  });

  it("quitar el secreto lo borra de Vault y del estado", async () => {
    const w = world({ config: { webhook_secret_saved_at: "2026-11-01T00:00:00Z" } });
    expect(await clearWebhookSecret(w.db.client, WS)).toEqual({ ok: true });
    expect(w.db.rpcCalls.map((c) => c.name)).toContain("delete_secret");
    expect(w.config()).not.toHaveProperty("webhook_secret_saved_at");
  });
});

describe("checkResendLive (Probar): solo lectura", () => {
  it("acceso completo: lee /domains y /webhooks, sin un solo POST ni PATCH", async () => {
    const w = world();
    const api = resendApi((method, path) => {
      if (path === "/domains") return [200, { data: [] }];
      if (path === "/webhooks") return [200, { data: [{ id: "wh_1", endpoint: `${RECEIVER}?w=${WS}`, events: ["email.received"] }] }];
      return [500, {}];
    });
    const res = await checkResendLive({ service: w.db.client, workspaceId: WS, fetchImpl: api.fetchImpl });
    expect(res).toEqual({ key: { ok: true, access: "full" }, webhook: { checked: true, found: true, missing: ["email.bounced", "email.complained"], disabled: false } });
    expect(api.calls.every((c) => c.method === "GET")).toBe(true);
    expect(w.db.writes()).toEqual([]);
  });

  it("key de solo envio: no intenta ver el webhook", async () => {
    const w = world();
    const api = resendApi(() => [401, { name: "restricted_api_key" }]);
    const res = await checkResendLive({ service: w.db.client, workspaceId: WS, fetchImpl: api.fetchImpl });
    expect(res.key).toEqual({ ok: true, access: "sending" });
    expect(res.webhook).toMatchObject({ checked: false });
    expect(api.calls).toHaveLength(1);
  });
});
