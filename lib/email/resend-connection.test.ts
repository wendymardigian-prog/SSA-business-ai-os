/**
 * El nucleo de la tarjeta Resend (R2): conectar el webhook guarda el secreto en Vault y el estado en el config de
 * `resend`; el plan B guarda un secreto pegado; "Probar" solo lee. Resend y Vault simulados.
 */

import { RESEND_WEBHOOK_EVENTS_LIST } from "./resend-events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-db";
import { checkResendLive, clearWebhookSecret, connectWebhookForWorkspace, saveReceiving, saveWebhookSecret } from "./resend-connection";
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
      // Cambio aprobado (00287): tambien entregas, aperturas y clics.
      webhook_events: "email.received,email.bounced,email.complained,email.delivered,email.opened,email.clicked",
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
      // Un webhook nuestro ya completo (todos los eventos de SSA: no hay nada que actualizar).
      if (method === "GET" && path === "/webhooks") return [200, { data: [{ id: "wh_1", endpoint: `${RECEIVER}?w=${WS}`, events: [...RESEND_WEBHOOK_EVENTS_LIST] }] }];
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

describe("saveReceiving (R4): recepcion por dominio", () => {
  // Las cuentas de Resend y los canales de mentira de este bloque.
  async function setup(opts: {
    domains?: Array<Record<string, unknown>> | { status: number; name?: string };
    existingChannel?: boolean;
    others?: Array<{ workspace_id: string; email_address: string }>;
  } = {}) {
    const { clearResendDomainsCache } = await import("./resend-domains");
    clearResendDomainsCache();
    let config: Record<string, unknown> = { from_email: "hola@negocio.test" };
    const db = fakeDb(
      {
        "integration_configs:select": () => ({ data: { config, is_active: true, last_event_at: null } }),
        "integration_configs:update": (call) => {
          config = (call.values as { config: typeof config }).config;
          return { data: null };
        },
        "channels:select": (call) =>
          call.filters.some((f) => f.method === "neq")
            ? { data: opts.others ?? [] }
            : { data: opts.existingChannel ? { id: "ch-existente" } : null },
        "channels:insert": { data: { id: "ch-nuevo" } },
      },
      { read_secret: { data: KEY } },
    );
    const domains = opts.domains ?? [{ name: "negocio.test", status: "verified", capabilities: { receiving: "enabled" } }];
    const fetchImpl = (async () =>
      Array.isArray(domains)
        ? new Response(JSON.stringify({ data: domains }), { status: 200 })
        : new Response(JSON.stringify({ name: domains.name ?? "x" }), { status: domains.status })) as unknown as typeof fetch;
    return { db, fetchImpl, config: () => config };
  }

  it("prendida con un dominio de la cuenta: crea el canal con la direccion principal y guarda dominio y usuario", async () => {
    const s = await setup();
    const res = await saveReceiving({ service: s.db.client, workspaceId: WS, enabled: true, domain: "Negocio.test", local: "Hola", fetchImpl: s.fetchImpl });
    expect(res).toEqual({ ok: true, enabled: true, address: "hola@negocio.test", channelCreated: { channelId: "ch-nuevo", label: "hola@negocio.test" }, warnings: [] });
    expect(s.db.writesTo("channels")[0]).toMatchObject({ op: "insert", values: expect.objectContaining({ platform: "email", email_address: "hola@negocio.test", is_active: true }) });
    expect(s.config()).toMatchObject({ from_email: "hola@negocio.test", receiving_enabled: "true", receiving_domain: "negocio.test", receiving_local: "hola" });
  });

  it("si ya habia canal (de la tarjeta vieja), lo mueve: no crea otro", async () => {
    const s = await setup({ existingChannel: true });
    const res = await saveReceiving({ service: s.db.client, workspaceId: WS, enabled: true, domain: "negocio.test", local: "soporte", fetchImpl: s.fetchImpl });
    expect(res).toMatchObject({ ok: true, address: "soporte@negocio.test", channelCreated: null });
    expect(s.db.writesTo("channels")).toEqual([expect.objectContaining({ op: "update", values: expect.objectContaining({ email_address: "soporte@negocio.test", is_active: true }) })]);
  });

  it("un dominio que no esta en la cuenta no se guarda", async () => {
    const s = await setup();
    const res = await saveReceiving({ service: s.db.client, workspaceId: WS, enabled: true, domain: "otro.test", local: "hola", fetchImpl: s.fetchImpl });
    expect(res.ok).toBe(false);
    expect(s.db.writes()).toEqual([]);
  });

  it("con Receiving apagado en Resend: se guarda con el aviso de que falta activarlo", async () => {
    const s = await setup({ domains: [{ name: "negocio.test", status: "verified", capabilities: { receiving: "disabled" } }] });
    const res = await saveReceiving({ service: s.db.client, workspaceId: WS, enabled: true, domain: "negocio.test", local: "hola", fetchImpl: s.fetchImpl });
    expect(res).toMatchObject({ ok: true, warnings: [expect.stringContaining("Falta activar Receiving")] });
  });

  it("plan B: con una key de solo envio (no lista dominios) se acepta el dominio escrito a mano", async () => {
    const s = await setup({ domains: { status: 401, name: "restricted_api_key" } });
    const res = await saveReceiving({ service: s.db.client, workspaceId: WS, enabled: true, domain: "negocio.test", local: "hola", fetchImpl: s.fetchImpl });
    expect(res).toMatchObject({ ok: true, address: "hola@negocio.test" });
  });

  it("otro negocio recibiendo en el mismo dominio: se guarda con un aviso", async () => {
    const s = await setup({ others: [{ workspace_id: "otro", email_address: "info@negocio.test" }] });
    const res = await saveReceiving({ service: s.db.client, workspaceId: WS, enabled: true, domain: "negocio.test", local: "hola", fetchImpl: s.fetchImpl });
    expect(res).toMatchObject({ ok: true, warnings: [expect.stringContaining("Otro negocio")] });
  });

  it("un usuario invalido no se guarda", async () => {
    const s = await setup();
    expect((await saveReceiving({ service: s.db.client, workspaceId: WS, enabled: true, domain: "negocio.test", local: "con espacio", fetchImpl: s.fetchImpl })).ok).toBe(false);
  });

  it("apagada: desactiva el canal y conserva dominio y usuario para volver a prender", async () => {
    const s = await setup();
    const res = await saveReceiving({ service: s.db.client, workspaceId: WS, enabled: false, domain: "negocio.test", local: "hola", fetchImpl: s.fetchImpl });
    expect(res).toMatchObject({ ok: true, enabled: false });
    expect(s.db.writesTo("channels")).toEqual([expect.objectContaining({ op: "update", values: { is_active: false } })]);
    expect(s.config()).not.toHaveProperty("receiving_enabled");
    expect(s.config()).toMatchObject({ receiving_domain: "negocio.test", receiving_local: "hola" });
  });
});
