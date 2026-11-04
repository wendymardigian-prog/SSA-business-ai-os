/**
 * El webhook de Resend de SSA (R2), con la API simulada: nunca se llama a Resend de verdad.
 *
 * Lo que mas importa: SSA solo toca SU webhook. Uno con otra URL, o con `?w=` de otro negocio, no recibe ningun PATCH
 * ni DELETE (y este modulo no sabe borrar).
 */

import { describe, it, expect } from "vitest";
import {
  RESEND_WEBHOOK_EVENTS,
  connectResendWebhook,
  findOurWebhook,
  inspectResendWebhook,
  isValidSigningSecret,
  missingEvents,
  ownershipOf,
  type ResendWebhook,
} from "./resend-webhook";
import { classifyResendFailure, probeResendKey } from "./resend-api";

const WS = "11111111-1111-1111-1111-111111111111";
const OTHER_WS = "22222222-2222-2222-2222-222222222222";
const RECEIVER = "https://app.negocio.test/api/webhooks/resend-inbound";
const URL_MINE = `${RECEIVER}?w=${WS}`;
const SECRET = `whsec_${Buffer.from("secreto-que-devuelve-resend-123").toString("base64")}`;

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Una cuenta de Resend de mentira: guarda los webhooks y registra cada llamada. */
function fakeResend(opts: {
  webhooks?: Array<ResendWebhook & { signing_secret?: string | null }>;
  status?: number;
  errorName?: string;
  detailSecret?: string | null;
} = {}) {
  const calls: Call[] = [];
  const hooks = (opts.webhooks ?? []).map((w) => ({ ...w }));
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    if (opts.status) return json(opts.status, { name: opts.errorName ?? "error", message: "x" });

    if (method === "GET" && url.pathname === "/webhooks") {
      return json(200, { object: "list", has_more: false, data: hooks.map(({ signing_secret: _s, ...w }) => w) });
    }
    if (method === "POST" && url.pathname === "/webhooks") {
      const created = { id: "wh_new", endpoint: body.endpoint, events: body.events, status: "enabled" };
      hooks.push(created);
      return json(200, { object: "webhook", id: "wh_new", signing_secret: SECRET });
    }
    const match = url.pathname.match(/^\/webhooks\/(.+)$/);
    if (match) {
      const hook = hooks.find((h) => h.id === decodeURIComponent(match[1]));
      if (!hook) return json(404, { name: "not_found" });
      if (method === "PATCH") {
        Object.assign(hook, body);
        return json(200, { object: "webhook", id: hook.id });
      }
      if (method === "GET") {
        const secret = opts.detailSecret === undefined ? (hook.signing_secret ?? SECRET) : opts.detailSecret;
        return json(200, { object: "webhook", ...hook, signing_secret: secret });
      }
    }
    if (method === "GET" && url.pathname === "/domains") return json(200, { data: [] });
    return json(500, { name: "unexpected" });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, hooks };
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

describe("ownershipOf: de quien es un webhook", () => {
  it("la URL de SSA con ?w= de este negocio es mia; sin query es de SSA (se adopta)", () => {
    expect(ownershipOf(URL_MINE, RECEIVER, WS)).toBe("mine");
    expect(ownershipOf(RECEIVER, RECEIVER, WS)).toBe("legacy");
    expect(ownershipOf(`${RECEIVER}/`, RECEIVER, WS)).toBe("legacy");
    expect(ownershipOf("HTTPS://APP.NEGOCIO.TEST/api/webhooks/resend-inbound", RECEIVER, WS)).toBe("legacy");
  });

  it("con ?w= de OTRO negocio, otra ruta, otro dominio u otra query: no es mio", () => {
    expect(ownershipOf(`${RECEIVER}?w=${OTHER_WS}`, RECEIVER, WS)).toBe("other_workspace");
    expect(ownershipOf("https://app.negocio.test/api/webhooks/otra-cosa", RECEIVER, WS)).toBe("foreign");
    expect(ownershipOf("https://otro-sistema.test/api/webhooks/resend-inbound", RECEIVER, WS)).toBe("foreign");
    expect(ownershipOf(`${RECEIVER}?w=${WS}&x=1`, RECEIVER, WS)).toBe("foreign");
    expect(ownershipOf(`${RECEIVER}?token=abc`, RECEIVER, WS)).toBe("foreign");
    expect(ownershipOf("no es una url", RECEIVER, WS)).toBe("foreign");
  });
});

describe("connectResendWebhook", () => {
  it("sin ningun webhook de SSA: lo crea con los 3 eventos y devuelve el secreto", async () => {
    const r = fakeResend();
    const res = await connectResendWebhook({ apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    expect(res).toEqual({ ok: true, action: "created", webhookId: "wh_new", events: [...RESEND_WEBHOOK_EVENTS], secret: SECRET, disabled: false });
    expect(writes(r.calls)).toEqual([{ method: "POST", path: "/webhooks", body: { endpoint: URL_MINE, events: [...RESEND_WEBHOOK_EVENTS] } }]);
  });

  it("uno creado a mano con la URL de SSA (sin ?w=): lo ADOPTA, le pone ?w= y suma los eventos sin sacar ninguno", async () => {
    const r = fakeResend({ webhooks: [{ id: "wh_mano", endpoint: RECEIVER, events: ["email.bounced", "email.delivered"], status: "enabled" }] });
    const res = await connectResendWebhook({ apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    expect(res).toMatchObject({ ok: true, action: "adopted", webhookId: "wh_mano", secret: SECRET });
    const patch = writes(r.calls);
    expect(patch).toHaveLength(1);
    expect(patch[0]).toMatchObject({ method: "PATCH", path: "/webhooks/wh_mano" });
    expect((patch[0].body as { endpoint: string }).endpoint).toBe(URL_MINE);
    // Cambio aprobado (00287): SSA suma tambien aperturas y clics (los resultados de cada envio).
    expect(new Set((patch[0].body as { events: string[] }).events)).toEqual(new Set(["email.bounced", "email.delivered", "email.received", "email.complained", "email.opened", "email.clicked"]));
  });

  it("el nuestro con eventos que faltan: lo actualiza", async () => {
    const r = fakeResend({ webhooks: [{ id: "wh_1", endpoint: URL_MINE, events: ["email.received"], status: "enabled" }] });
    const res = await connectResendWebhook({ apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    expect(res).toMatchObject({ ok: true, action: "updated", webhookId: "wh_1" });
    expect(missingEvents((res as { events: string[] }).events)).toEqual([]);
  });

  it("el nuestro ya completo: no escribe nada (solo lee el secreto)", async () => {
    const r = fakeResend({ webhooks: [{ id: "wh_1", endpoint: URL_MINE, events: [...RESEND_WEBHOOK_EVENTS], status: "enabled" }] });
    const res = await connectResendWebhook({ apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    expect(res).toMatchObject({ ok: true, action: "unchanged", secret: SECRET });
    expect(writes(r.calls)).toEqual([]);
  });

  it("si Resend no devuelve el secreto del existente: secret null (la pantalla pide pegarlo)", async () => {
    const r = fakeResend({ webhooks: [{ id: "wh_mano", endpoint: RECEIVER, events: [...RESEND_WEBHOOK_EVENTS], status: "enabled" }], detailSecret: null });
    const res = await connectResendWebhook({ apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    expect(res).toMatchObject({ ok: true, action: "adopted", secret: null });
  });

  it("NUNCA toca un webhook de otro sistema ni el de otro negocio: crea el suyo aparte", async () => {
    const foreign = { id: "wh_otro_sistema", endpoint: "https://otro-sistema.test/hooks/resend", events: ["email.sent"], status: "enabled" };
    const otherWs = { id: "wh_otro_negocio", endpoint: `${RECEIVER}?w=${OTHER_WS}`, events: ["email.bounced"], status: "enabled" };
    const r = fakeResend({ webhooks: [foreign, otherWs] });
    const res = await connectResendWebhook({ apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    expect(res).toMatchObject({ ok: true, action: "created" });
    // Ninguna llamada (ni lectura por id, ni PATCH, ni DELETE) a los ids ajenos.
    expect(r.calls.filter((c) => c.path.includes("wh_otro"))).toEqual([]);
    expect(r.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(r.hooks.find((h) => h.id === "wh_otro_sistema")).toEqual(foreign);
    expect(r.hooks.find((h) => h.id === "wh_otro_negocio")).toEqual(otherWs);
  });

  it("el propio (?w=) gana sobre uno sin query: el de sin query no se toca", async () => {
    const r = fakeResend({
      webhooks: [
        { id: "wh_legacy", endpoint: RECEIVER, events: ["email.bounced"], status: "enabled" },
        { id: "wh_mio", endpoint: URL_MINE, events: [...RESEND_WEBHOOK_EVENTS], status: "enabled" },
      ],
    });
    const res = await connectResendWebhook({ apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    expect(res).toMatchObject({ ok: true, webhookId: "wh_mio", action: "unchanged" });
    expect(r.calls.filter((c) => c.path.includes("wh_legacy"))).toEqual([]);
  });

  it("key de solo envio: restricted (plan B a mano), sin escribir nada", async () => {
    const r = fakeResend({ status: 401, errorName: "restricted_api_key" });
    const res = await connectResendWebhook({ apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    expect(res).toEqual({ ok: false, reason: "restricted" });
    expect(writes(r.calls)).toEqual([]);
  });

  it("Resend caido: failed, nunca lanza", async () => {
    const res = await connectResendWebhook({
      apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER,
      fetchImpl: (async () => { throw new Error("red caida"); }) as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: false, reason: "failed" });
  });

  it("un webhook propio desactivado en Resend se informa, no se reactiva solo", async () => {
    const r = fakeResend({ webhooks: [{ id: "wh_1", endpoint: URL_MINE, events: [...RESEND_WEBHOOK_EVENTS], status: "disabled" }] });
    const res = await connectResendWebhook({ apiKey: "re_x", workspaceId: WS, url: URL_MINE, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    expect(res).toMatchObject({ ok: true, disabled: true });
    expect(writes(r.calls)).toEqual([]);
  });
});

describe("inspectResendWebhook (Probar: solo lectura)", () => {
  it("dice que eventos faltan sin escribir nada", async () => {
    const r = fakeResend({ webhooks: [{ id: "wh_1", endpoint: URL_MINE, events: ["email.received"], status: "enabled" }] });
    const res = await inspectResendWebhook({ apiKey: "re_x", workspaceId: WS, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl });
    // `missing`: lo imprescindible (lo que lo pone en rojo). `missingOptional` (00287): los de resultados, que se sugieren.
    expect(res).toEqual({
      ok: true,
      found: true,
      webhookId: "wh_1",
      ownership: "mine",
      missing: ["email.bounced", "email.complained"],
      missingOptional: ["email.delivered", "email.opened", "email.clicked"],
      disabled: false,
    });
    expect(writes(r.calls)).toEqual([]);
  });

  it("sin webhook de SSA: found false", async () => {
    const r = fakeResend({ webhooks: [{ id: "wh_x", endpoint: "https://otro.test/x", events: [], status: "enabled" }] });
    expect(await inspectResendWebhook({ apiKey: "re_x", workspaceId: WS, receiverUrl: RECEIVER, fetchImpl: r.fetchImpl })).toEqual({ ok: true, found: false });
  });
});

describe("findOurWebhook", () => {
  it("ignora los de otro negocio aunque sean la URL de SSA", () => {
    expect(findOurWebhook([{ id: "a", endpoint: `${RECEIVER}?w=${OTHER_WS}`, events: [], status: null }], RECEIVER, WS)).toBeNull();
  });
});

describe("la key: acceso completo, solo envio o invalida", () => {
  it("classifyResendFailure", () => {
    expect(classifyResendFailure(401, "restricted_api_key")).toBe("restricted");
    expect(classifyResendFailure(403, "restricted_api_key")).toBe("invalid_key");
    expect(classifyResendFailure(401, "validation_error")).toBe("invalid_key");
    expect(classifyResendFailure(400, null)).toBe("invalid_key");
    expect(classifyResendFailure(429, "rate_limit_exceeded")).toBe("failed");
    expect(classifyResendFailure(500, null)).toBe("failed");
  });

  it("probeResendKey: GET /domains", async () => {
    expect(await probeResendKey("re_x", fakeResend().fetchImpl)).toEqual({ ok: true, access: "full" });
    expect(await probeResendKey("re_x", fakeResend({ status: 401, errorName: "restricted_api_key" }).fetchImpl)).toEqual({ ok: true, access: "sending" });
    expect(await probeResendKey("re_x", fakeResend({ status: 401, errorName: "validation_error" }).fetchImpl)).toEqual({ ok: false, reason: "invalid_key" });
    expect(await probeResendKey("re_x", fakeResend({ status: 503 }).fetchImpl)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("isValidSigningSecret", () => {
  it("whsec_ + base64", () => {
    expect(isValidSigningSecret(SECRET)).toBe(true);
    expect(isValidSigningSecret(`  ${SECRET}  `)).toBe(true);
    expect(isValidSigningSecret("whsec_corto")).toBe(false);
    expect(isValidSigningSecret("re_abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(isValidSigningSecret("whsec_esto no es base64!!!!!!!!!")).toBe(false);
  });
});
