import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { signWebhook, verifyWebhook, webhookDeliveryId, webhookSecretProblem, WEBHOOK_SIGNATURE_HEADER } from "./webhook-signature";

const readSecret = vi.fn<(...args: unknown[]) => Promise<string | null>>();
vi.mock("@/lib/vault", () => ({ readSecret: (...args: unknown[]) => readSecret(...args) }));

const SECRET = "clave-de-prueba-0123456789";

describe("firma de la Llamada HTTP", () => {
  it("firma y comprueba ida y vuelta", () => {
    const h = signWebhook(SECRET, "s1:n1", '{"a":1}', 1_700_000_000);
    expect(verifyWebhook(SECRET, h, '{"a":1}', 1_700_000_100)).toEqual({ ok: true });
    // Los nombres de los headers llegan en minúscula por HTTP.
    const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
    expect(verifyWebhook(SECRET, lower, '{"a":1}', 1_700_000_100)).toEqual({ ok: true });
  });

  it("rechaza otra clave, otro cuerpo, una firma vieja o sin headers", () => {
    const h = signWebhook(SECRET, "s1:n1", "{}", 1_700_000_000);
    expect(verifyWebhook("otra-clave-0123456789", h, "{}", 1_700_000_000)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyWebhook(SECRET, h, '{"x":1}', 1_700_000_000)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyWebhook(SECRET, h, "{}", 1_700_000_000 + 301)).toEqual({ ok: false, reason: "stale" });
    expect(verifyWebhook(SECRET, {}, "{}", 1_700_000_000)).toEqual({ ok: false, reason: "missing" });
    expect(verifyWebhook(SECRET, { ...h, [WEBHOOK_SIGNATURE_HEADER]: "v1=zz" }, "{}", 1_700_000_000)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("el id es estable por paso de una ejecución", () => {
    expect(webhookDeliveryId("sesion", "nodo")).toBe("sesion:nodo");
  });

  it("valida la clave que se quiere guardar", () => {
    expect(webhookSecretProblem("corta")).toMatch(/al menos 16/);
    expect(webhookSecretProblem("con espacio 0123456789")).toMatch(/espacios/);
    expect(webhookSecretProblem("x".repeat(257))).toMatch(/larga/);
    expect(webhookSecretProblem(SECRET)).toBeNull();
  });
});

// ─── Contra un receptor local de verdad (TCP en 127.0.0.1) ─────────────────────────────────────────────────────────

type Received = { method: string; url: string; headers: IncomingHttpHeaders; body: string };
let server: Server;
let port = 0;
const received: Received[] = [];

/** Un `fetch` mínimo que solo habla con 127.0.0.1 (el setup bloquea el `fetch` real en todos los tests). */
function loopbackFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
  if (url.hostname !== "127.0.0.1") return Promise.reject(new Error(`solo 127.0.0.1: ${url.hostname}`));
  return new Promise((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", headers: init?.headers as Record<string, string> },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: res.headers as Record<string, string> })));
      },
    );
    req.on("error", reject);
    if (typeof init?.body === "string") req.write(init.body);
    req.end();
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      received.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      // El receptor comprueba la firma como lo haría quien recibe.
      const check = verifyWebhook(SECRET, req.headers as Record<string, string>, body, Math.floor(Date.now() / 1000));
      res.writeHead(check.ok ? 200 : 401, { "Content-Type": "application/json" });
      res.end(JSON.stringify(check));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

afterEach(() => {
  received.length = 0;
  readSecret.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function runNode(data: Record<string, unknown>) {
  vi.stubEnv("AUTOMATION_HTTP_ALLOW_LOOPBACK", "1");
  vi.stubGlobal("fetch", loopbackFetch);
  const { httpRequestNode } = await import("@/lib/flow-engine/nodes/http-request");
  const noteStep = vi.fn();
  const context = { workspaceId: "ws-1", variables: { nombre: "Ana" } as Record<string, unknown>, noteStep };
  await httpRequestNode.execute({
    supabase: {} as never,
    node: { id: "nodo-1" } as never,
    data: { method: "POST", url: `http://127.0.0.1:${port}/hook`, body: '{"nombre":"{{nombre}}"}', responseVariable: "r", ...data } as never,
    context: context as never,
    sessionId: "sesion-1",
    runtime: {} as never,
  });
  return { context, noteStep };
}

describe("«Firmar la llamada» contra un receptor local", () => {
  it("sale firmada y el receptor la acepta", async () => {
    readSecret.mockResolvedValue(SECRET);
    const { context, noteStep } = await runNode({ sign: true });
    expect(received).toHaveLength(1);
    expect(received[0].body).toBe('{"nombre":"Ana"}');
    expect(received[0].headers["x-webhook-id"]).toBe("sesion-1:nodo-1");
    expect(received[0].headers["x-webhook-signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(context.variables.r_status).toBe("200");
    expect(context.variables.r).toEqual({ ok: true });
    expect(noteStep).not.toHaveBeenCalled();
    expect(readSecret).toHaveBeenCalledWith(expect.anything(), "ws-1", "automation_webhook_secret");
  });

  it("con otra clave en el negocio, el receptor la rechaza (401)", async () => {
    readSecret.mockResolvedValue("otra-clave-0123456789");
    const { context, noteStep } = await runNode({ sign: true });
    expect(received).toHaveLength(1);
    expect(context.variables.r_status).toBe("401");
    expect(noteStep).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("sin la clave guardada no manda nada (nunca sale sin firmar)", async () => {
    readSecret.mockResolvedValue(null);
    const { context, noteStep } = await runNode({ sign: true });
    expect(received).toHaveLength(0);
    expect(context.variables.r_ok).toBe("false");
    expect(noteStep).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", reason: expect.stringMatching(/Falta la clave/) }));
  });

  it("si no se puede leer la clave, tampoco manda nada", async () => {
    readSecret.mockRejectedValue(new Error("permission denied"));
    const { noteStep } = await runNode({ sign: true });
    expect(received).toHaveLength(0);
    expect(noteStep).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", reason: expect.stringMatching(/No se pudo leer/) }));
  });

  it("sin «Firmar» sale como siempre, sin headers de firma ni lectura de la clave", async () => {
    const { context } = await runNode({});
    expect(received).toHaveLength(1);
    expect(received[0].headers["x-webhook-signature"]).toBeUndefined();
    expect(readSecret).not.toHaveBeenCalled();
    expect(context.variables.r_status).toBe("401");
  });

  it("sin el permiso de loopback, 127.0.0.1 sigue bloqueado", async () => {
    readSecret.mockResolvedValue(SECRET);
    vi.stubGlobal("fetch", loopbackFetch);
    const { httpRequestNode } = await import("@/lib/flow-engine/nodes/http-request");
    const noteStep = vi.fn();
    await httpRequestNode.execute({
      supabase: {} as never,
      node: { id: "nodo-1" } as never,
      data: { method: "POST", url: `http://127.0.0.1:${port}/hook`, body: "{}", sign: true } as never,
      context: { workspaceId: "ws-1", variables: {}, noteStep } as never,
      sessionId: "sesion-1",
      runtime: {} as never,
    });
    expect(received).toHaveLength(0);
    expect(noteStep).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });
});
