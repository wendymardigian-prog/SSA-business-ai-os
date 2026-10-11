import { describe, it, expect, vi } from "vitest";
import { checkTurnstileSecret, SITEVERIFY_URL, verifyTurnstile } from "./turnstile";

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("verifyTurnstile", () => {
  it("success: true da ok", async () => {
    const fetchImpl = vi.fn(async () => json({ success: true }));
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl })).toEqual({ ok: true });
  });

  it("timeout-or-duplicate se devuelve con ese código", async () => {
    const fetchImpl = vi.fn(async () => json({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl })).toEqual({ ok: false, codes: ["timeout-or-duplicate"] });
  });

  it("si fetch falla da network y NO lanza", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("sin red");
    });
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl })).toEqual({ ok: false, codes: ["network"] });
  });

  it("una respuesta HTTP de error o rota también es network", async () => {
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: vi.fn(async () => json({}, 500)) })).toEqual({ ok: false, codes: ["network"] });
    const broken = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("no es json"); } }) as unknown as Response);
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: broken })).toEqual({ ok: false, codes: ["network"] });
  });

  it("success false sin códigos da unknown", async () => {
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: vi.fn(async () => json({ success: false })) })).toEqual({ ok: false, codes: ["unknown"] });
  });

  it("el cuerpo enviado a Cloudflare incluye secret, response, remoteip e idempotency_key", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => json({ success: true }));
    await verifyTurnstile({ secret: "la-secreta", token: "el-token", ip: "203.0.113.9", idempotencyKey: "3f0c1c2e-0000-4000-8000-000000000001", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("secret")).toBe("la-secreta");
    expect(body.get("response")).toBe("el-token");
    expect(body.get("remoteip")).toBe("203.0.113.9");
    expect(body.get("idempotency_key")).toBe("3f0c1c2e-0000-4000-8000-000000000001");
  });

  it("sin ip ni idempotencia, esos parámetros no se mandan", async () => {
    const fetchImpl = vi.fn(async () => json({ success: true }));
    await verifyTurnstile({ secret: "s", token: "t", fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.has("remoteip")).toBe(false);
    expect(body.has("idempotency_key")).toBe(false);
  });
});

describe("checkTurnstileSecret", () => {
  it("invalid-input-secret → la clave no es válida", async () => {
    const r = await checkTurnstileSecret("mala", vi.fn(async () => json({ success: false, "error-codes": ["invalid-input-secret"] })));
    expect(r).toEqual({ ok: false, error: "La secret key no es válida" });
  });

  it("invalid-input-response → la clave existe", async () => {
    const r = await checkTurnstileSecret("buena", vi.fn(async () => json({ success: false, "error-codes": ["invalid-input-response"] })));
    expect(r).toEqual({ ok: true });
  });

  it("las claves de prueba que siempre aprueban también pasan", async () => {
    expect(await checkTurnstileSecret("1x0000000000000000000000000000000AA", vi.fn(async () => json({ success: true })))).toEqual({ ok: true });
  });

  it("sin red da un error entendible", async () => {
    const r = await checkTurnstileSecret("s", vi.fn(async () => { throw new Error("x"); }));
    expect(r.ok).toBe(false);
  });
});
