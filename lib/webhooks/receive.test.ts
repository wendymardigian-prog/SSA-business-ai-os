import { describe, expect, it, vi } from "vitest";
import {
  bodyHash,
  canonicalJson,
  externalEventId,
  isValidTokenShape,
  parseBody,
  receiveWebhook,
  truncateIp,
  type EndpointRow,
  type InboundInsert,
  type ReceiveDeps,
  type ReceiveInput,
} from "./receive";
import { isListening } from "./listen";

const TOKEN = "A".repeat(22);
const NOW = new Date("2026-10-12T12:00:00Z");

const endpoint = (over: Partial<EndpointRow> = {}): EndpointRow => ({
  id: "ep-1",
  workspace_id: "ws-1",
  status: "active",
  secret_vault_name: null,
  event_id_path: null,
  listen_until: null,
  ...over,
});

function setup(opts: { endpoint?: EndpointRow | null; body?: string; tooLarge?: boolean; allowed?: boolean; recentSame?: boolean; secret?: string | null } = {}) {
  const inserted: InboundInsert[] = [];
  const calls: string[] = [];
  const deps: ReceiveDeps = {
    now: () => NOW,
    findEndpoint: vi.fn(async () => {
      calls.push("findEndpoint");
      return opts.endpoint === undefined ? endpoint() : opts.endpoint;
    }),
    readSecret: vi.fn(async () => opts.secret ?? null),
    equals: (a, b) => a === b,
    limit: vi.fn(async () => {
      calls.push("limit");
      return { allowed: opts.allowed ?? true };
    }),
    readBody: vi.fn(async () => {
      calls.push("readBody");
      if (opts.tooLarge) return { tooLarge: true as const };
      const text = opts.body ?? "{}";
      return { text, bytes: Buffer.byteLength(text) };
    }),
    hasRecentSameBody: vi.fn(async () => opts.recentSame ?? false),
    insertInbound: vi.fn(async (row) => {
      inserted.push(row);
      return { kind: "inserted" as const, id: "in-1" };
    }),
    captureSample: vi.fn(async () => {}),
  };
  return { deps, inserted, calls };
}

const input = (over: Partial<ReceiveInput> = {}): ReceiveInput => ({
  token: TOKEN,
  secretHeader: null,
  contentType: "application/json",
  searchParams: new URLSearchParams(),
  ip: "203.0.113.77",
  userAgent: "Typeform/1.0",
  ...over,
});

describe("receiveWebhook: orden de las validaciones", () => {
  it("un token con otra forma responde 404 sin consultar la base", async () => {
    const { deps } = setup();
    for (const token of ["", "corto", "A".repeat(21), "A".repeat(23), "A".repeat(21) + "!", "../../etc/passwd"]) {
      const res = await receiveWebhook(deps, input({ token }));
      expect(res.status).toBe(404);
    }
    expect(deps.findEndpoint).not.toHaveBeenCalled();
    expect(deps.limit).not.toHaveBeenCalled();
    expect(deps.insertInbound).not.toHaveBeenCalled();
  });

  it("un endpoint que no existe responde 404", async () => {
    const { deps } = setup({ endpoint: null });
    expect((await receiveWebhook(deps, input())).status).toBe(404);
  });

  it("si la lectura del endpoint falla responde 500 (para que el emisor reintente)", async () => {
    const { deps } = setup();
    (deps.findEndpoint as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
    expect((await receiveWebhook(deps, input())).status).toBe(500);
  });

  it("con secreto exigido: sin header o distinto da 401 y no guarda; si en Vault no hay, 404", async () => {
    const ep = endpoint({ secret_vault_name: "webhook_secret:ep-1" });
    const a = setup({ endpoint: ep, secret: "s3creto" });
    expect((await receiveWebhook(a.deps, input())).status).toBe(401);
    expect((await receiveWebhook(a.deps, input({ secretHeader: "otro" }))).status).toBe(401);
    expect(a.inserted).toHaveLength(0);
    expect((await receiveWebhook(a.deps, input({ secretHeader: "s3creto" }))).status).toBe(200);

    const b = setup({ endpoint: ep, secret: null });
    expect((await receiveWebhook(b.deps, input({ secretHeader: "x" }))).status).toBe(404);
  });

  it("el tope se cuenta antes de leer el cuerpo: 429 con Retry-After y sin guardar", async () => {
    const { deps, inserted, calls } = setup({ allowed: false });
    const res = await receiveWebhook(deps, input());
    expect(res.status).toBe(429);
    expect(res.headers?.["Retry-After"]).toBeTruthy();
    expect(inserted).toHaveLength(0);
    expect(calls).not.toContain("readBody");
  });

  it("un cuerpo de mas de 256 KB responde 413 sin guardar", async () => {
    const { deps, inserted } = setup({ tooLarge: true });
    expect((await receiveWebhook(deps, input())).status).toBe(413);
    expect(inserted).toHaveLength(0);
  });

  it("el orden es endpoint -> tope -> cuerpo", async () => {
    const { deps, calls } = setup();
    await receiveWebhook(deps, input());
    expect(calls).toEqual(["findEndpoint", "limit", "readBody"]);
  });
});

describe("receiveWebhook: lo que se guarda", () => {
  it("form-urlencoded se guarda como objeto plano", async () => {
    const { deps, inserted } = setup({ body: "email=a%40b.com&name=Ana" });
    await receiveWebhook(deps, input({ contentType: "application/x-www-form-urlencoded" }));
    expect(inserted[0].payload).toEqual({ email: "a@b.com", name: "Ana" });
  });

  it("los parametros de la URL van a query", async () => {
    const { deps, inserted } = setup();
    await receiveWebhook(deps, input({ searchParams: new URLSearchParams("utm_source=fb") }));
    expect(inserted[0].query).toEqual({ utm_source: "fb" });
  });

  it("guarda la IP truncada y el user agent recortado, nunca headers de autorizacion", async () => {
    const { deps, inserted } = setup();
    await receiveWebhook(deps, input({ userAgent: "x".repeat(500) }));
    expect(inserted[0].ipPrefix).toBe("203.0.113.0/24");
    expect(inserted[0].userAgent).toHaveLength(300);
    expect(JSON.stringify(inserted[0])).not.toContain("203.0.113.77");
  });

  it("un JSON roto no devuelve 400: se guarda como _raw con estado error", async () => {
    const { deps, inserted } = setup({ body: "{no es json" });
    const res = await receiveWebhook(deps, input());
    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ status: "error", errorMessage: "cuerpo no es JSON", payload: { _raw: "{no es json" } });
    expect(res.process).toBeUndefined();
  });

  it("un envio normal queda received y pide procesarse", async () => {
    const { deps } = setup({ body: '{"email":"a@b.com"}' });
    const res = await receiveWebhook(deps, input());
    expect(res).toMatchObject({ status: 200, body: { ok: true, id: "in-1" }, process: { inboundId: "in-1", endpointId: "ep-1" } });
  });
});

describe("receiveWebhook: estados", () => {
  it("un endpoint pausado guarda con status paused, responde 200 y no procesa", async () => {
    const { deps, inserted } = setup({ endpoint: endpoint({ status: "paused" }) });
    const res = await receiveWebhook(deps, input());
    expect(res.status).toBe(200);
    expect(inserted[0].status).toBe("paused");
    expect(res.process).toBeUndefined();
  });

  it("un endpoint escuchando captura el ejemplo, queda captured y no procesa", async () => {
    const { deps, inserted } = setup({ endpoint: endpoint({ listen_until: new Date(NOW.getTime() + 60_000).toISOString() }), body: '{"a":1}' });
    const res = await receiveWebhook(deps, input());
    expect(inserted[0].status).toBe("captured");
    expect(deps.captureSample).toHaveBeenCalledWith("ep-1", expect.objectContaining({ payload: { a: 1 } }));
    expect(res.process).toBeUndefined();
  });

  it("una escucha vencida se trata como no escuchando", async () => {
    const { deps, inserted } = setup({ endpoint: endpoint({ listen_until: new Date(NOW.getTime() - 1000).toISOString() }) });
    await receiveWebhook(deps, input());
    expect(inserted[0].status).toBe("received");
    expect(deps.captureSample).not.toHaveBeenCalled();
  });

  it("sin id de envio, un cuerpo identico en 10 minutos queda ignored (200)", async () => {
    const { deps, inserted } = setup({ recentSame: true });
    const res = await receiveWebhook(deps, input());
    expect(res.status).toBe(200);
    expect(inserted[0].status).toBe("ignored");
    expect(res.process).toBeUndefined();
  });

  it("con id de envio no se mira la huella: el indice unico decide", async () => {
    const { deps, inserted } = setup({ endpoint: endpoint({ event_id_path: "event_id" }), body: '{"event_id":"e-1"}', recentSame: true });
    await receiveWebhook(deps, input());
    expect(deps.hasRecentSameBody).not.toHaveBeenCalled();
    expect(inserted[0]).toMatchObject({ status: "received", externalEventId: "e-1" });
  });

  it("el mismo id de envio por segunda vez responde 200 duplicate y no procesa", async () => {
    const { deps } = setup({ endpoint: endpoint({ event_id_path: "event_id" }), body: '{"event_id":"e-1"}' });
    (deps.insertInbound as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ kind: "duplicate" });
    const res = await receiveWebhook(deps, input());
    expect(res).toEqual({ status: 200, body: { ok: true, duplicate: true } });
  });
});

describe("el receptor nunca escribe el token ni el secreto en un log", () => {
  it("ni con exito ni con error", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const ep = endpoint({ secret_vault_name: "webhook_secret:ep-1" });
    const a = setup({ endpoint: ep, secret: "s3creto-largo" });
    await receiveWebhook(a.deps, input({ secretHeader: "s3creto-largo" }));
    await receiveWebhook(a.deps, input({ secretHeader: "mal" }));
    (a.deps.findEndpoint as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    await receiveWebhook(a.deps, input());
    const logged = spies.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("s3creto-largo");
    spies.forEach((s) => s.mockRestore());
  });
});

describe("parseBody", () => {
  it("JSON, raiz que no es objeto, vacio y tipo desconocido", () => {
    expect(parseBody('{"a":1}', "application/json")).toEqual({ payload: { a: 1 }, error: null });
    expect(parseBody("[1,2]", "application/json").payload).toEqual({ _value: [1, 2] });
    expect(parseBody("", "application/json")).toEqual({ payload: {}, error: null });
    expect(parseBody("hola", "text/plain")).toEqual({ payload: { _raw: "hola" }, error: null });
    expect(parseBody('{"a":1}', "text/plain").payload).toEqual({ a: 1 });
  });

  it("una clave repetida en un formulario pasa a lista y __proto__ se descarta", () => {
    expect(parseBody("tag=a&tag=b&__proto__=x", "application/x-www-form-urlencoded").payload).toEqual({ tag: ["a", "b"] });
  });
});

describe("idempotencia", () => {
  it("la huella no depende del orden de las claves", () => {
    expect(bodyHash({ a: 1, b: { c: 2, d: 3 } }, {})).toBe(bodyHash({ b: { d: 3, c: 2 }, a: 1 }, {}));
    expect(canonicalJson({ b: 1, a: [2, { z: 1, y: 2 }] })).toBe('{"a":[2,{"y":2,"z":1}],"b":1}');
  });

  it("la query forma parte de la huella", () => {
    expect(bodyHash({ a: 1 }, { x: "1" })).not.toBe(bodyHash({ a: 1 }, { x: "2" }));
  });

  it("externalEventId lee la ruta (con indices) y descarta lo que no es escalar", () => {
    expect(externalEventId({ data: { id: 77 } }, {}, "data.id")).toBe("77");
    expect(externalEventId({ items: [{ id: "x" }] }, {}, "items.0.id")).toBe("x");
    expect(externalEventId({ data: { id: { n: 1 } } }, {}, "data.id")).toBeNull();
    expect(externalEventId({}, {}, "data.id")).toBeNull();
    expect(externalEventId({ a: 1 }, {}, null)).toBeNull();
  });
});

describe("truncateIp", () => {
  it("IPv4 a /24, IPv6 a /48, y lo raro a null", () => {
    expect(truncateIp("203.0.113.77")).toBe("203.0.113.0/24");
    expect(truncateIp("203.0.113.77, 10.0.0.1")).toBe("203.0.113.0/24");
    expect(truncateIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::/48");
    expect(truncateIp("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(truncateIp("::1")).toBe("0:0:0::/48");
    expect(truncateIp("999.1.1.1")).toBeNull();
    expect(truncateIp("no-es-ip")).toBeNull();
    expect(truncateIp(null)).toBeNull();
  });
});

describe("isListening / isValidTokenShape", () => {
  it("la escucha vence a los 15 minutos exactos", () => {
    expect(isListening(NOW, new Date(NOW.getTime() + 1).toISOString())).toBe(true);
    expect(isListening(NOW, NOW.toISOString())).toBe(false);
    expect(isListening(NOW, null)).toBe(false);
    expect(isListening(NOW, "no-fecha")).toBe(false);
  });

  it("acepta solo 22 caracteres URL-safe", () => {
    expect(isValidTokenShape(TOKEN)).toBe(true);
    expect(isValidTokenShape("a-b_c".padEnd(22, "x"))).toBe(true);
    expect(isValidTokenShape(undefined)).toBe(false);
  });
});
