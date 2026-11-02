import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestUnsubscribeLink, UNSUBSCRIBE_LINK_LIMITS, type UnsubscribeLinkPorts } from "./unsubscribe-link";

const ORIGIN = "https://tusitio.com";
const SELF = ["https://app.ejemplo.com"];
const WS = { id: "ws-1", settings: { allowedOrigins: [{ origin: ORIGIN, dev: false }] } };

function makePorts(over: Partial<UnsubscribeLinkPorts> = {}) {
  const counts = new Map<string, number>();
  const sent: Array<{ to: string; token: string }> = [];
  const ports: UnsubscribeLinkPorts = {
    limit: vi.fn(async (spec) => {
      const n = (counts.get(spec.key) ?? 0) + 1;
      counts.set(spec.key, n);
      return { allowed: n <= spec.max, count: n, max: spec.max };
    }),
    hash: (v) => `h(${v})`,
    findWorkspace: vi.fn(async (slug) => (slug === "mi-negocio" ? WS : null)),
    findToken: vi.fn(async (_ws, email) => (email === "ana@x.com" ? { contactId: "c-1", token: "tok-1" } : null)),
    sendLink: vi.fn(async ({ to, token }) => {
      sent.push({ to, token });
    }),
    ...over,
  };
  return { ports, sent };
}

const input = (body: unknown, over: Partial<Parameters<typeof requestUnsubscribeLink>[1]> = {}) => ({ body, ip: "203.0.113.9", origin: ORIGIN, self: SELF, ...over });

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

describe("requestUnsubscribeLink", () => {
  it("email que existe: responde ok YA y manda el link después", async () => {
    const { ports, sent } = makePorts();
    const out = await requestUnsubscribeLink(ports, input({ workspace: "mi-negocio", email: " ANA@x.com ", honeypot: "" }));
    expect(out).toMatchObject({ status: 200, body: { ok: true } });
    expect(out.headers["Access-Control-Allow-Origin"]).toBe(ORIGIN);
    expect(sent).toEqual([]); // todavía no: va en after()
    await out.later?.();
    expect(sent).toEqual([{ to: "ana@x.com", token: "tok-1" }]);
  });

  it("email que NO existe: la misma respuesta, y no se manda nada", async () => {
    const { ports, sent } = makePorts();
    const out = await requestUnsubscribeLink(ports, input({ workspace: "mi-negocio", email: "nadie@x.com" }));
    expect(out).toMatchObject({ status: 200, body: { ok: true } });
    await out.later?.();
    expect(sent).toEqual([]);
  });

  it("el slug también llega por la URL (?workspace=)", async () => {
    const { ports, sent } = makePorts();
    const out = await requestUnsubscribeLink(ports, input({ email: "ana@x.com" }, { queryWorkspace: "mi-negocio" }));
    await out.later?.();
    expect(sent).toHaveLength(1);
  });

  it.each([
    ["honeypot lleno", { workspace: "mi-negocio", email: "ana@x.com", honeypot: "bot" }, {}, "honeypot"],
    ["email inválido", { workspace: "mi-negocio", email: "no-es-email" }, {}, "invalid_email"],
    ["negocio que no existe", { workspace: "otro", email: "ana@x.com" }, {}, "origin"],
    ["origen que no es del negocio", { workspace: "mi-negocio", email: "ana@x.com" }, { origin: "https://otrositio.com" }, "origin"],
  ])("%s: ok sin hacer nada", async (_name, body, over, skipped) => {
    const { ports, sent } = makePorts();
    const out = await requestUnsubscribeLink(ports, input(body, over));
    expect(out).toMatchObject({ status: 200, body: { ok: true }, later: null, skipped });
    expect(sent).toEqual([]);
  });

  it("negocio que no existe, pedido sin Origin (curl): ok sin hacer nada", async () => {
    const { ports } = makePorts();
    const out = await requestUnsubscribeLink(ports, input({ workspace: "otro", email: "ana@x.com" }, { origin: null }));
    expect(out).toMatchObject({ status: 200, later: null, skipped: "unknown_workspace" });
  });

  it("un origen ajeno no recibe headers de CORS", async () => {
    const { ports } = makePorts();
    const out = await requestUnsubscribeLink(ports, input({ workspace: "mi-negocio", email: "ana@x.com" }, { origin: "https://otrositio.com" }));
    expect(out.headers).toEqual({});
  });

  it(`tope: ${UNSUBSCRIBE_LINK_LIMITS.perEmailPerDay} por día por email`, async () => {
    const { ports, sent } = makePorts();
    for (let i = 0; i < 4; i++) {
      const out = await requestUnsubscribeLink(ports, input({ workspace: "mi-negocio", email: "ana@x.com" }, { ip: `10.0.0.${i}` }));
      await out.later?.();
    }
    expect(sent).toHaveLength(UNSUBSCRIBE_LINK_LIMITS.perEmailPerDay);
  });

  it(`tope: ${UNSUBSCRIBE_LINK_LIMITS.perIpPerHour} por hora por IP`, async () => {
    const { ports } = makePorts();
    const outs = [];
    for (let i = 0; i < 6; i++) outs.push(await requestUnsubscribeLink(ports, input({ workspace: "mi-negocio", email: `p${i}@x.com` })));
    expect(outs.map((o) => o.skipped ?? "ok")).toEqual(["ok", "ok", "ok", "ok", "ok", "ip_limit"]);
    expect(outs.every((o) => o.status === 200)).toBe(true);
  });

  it("las claves de los topes no llevan el email en claro", async () => {
    const { ports } = makePorts();
    await requestUnsubscribeLink(ports, input({ workspace: "mi-negocio", email: "ana@x.com" }));
    const keys = (ports.limit as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].key as string);
    expect(keys.every((k) => !k.includes("ana@x.com") || k.includes("h("))).toBe(true);
  });

  it("un cuerpo ilegible es 400; nada más da error", async () => {
    const { ports } = makePorts();
    expect((await requestUnsubscribeLink(ports, input(undefined))).status).toBe(400);
    expect((await requestUnsubscribeLink(ports, input([1, 2]))).status).toBe(400);
    expect((await requestUnsubscribeLink(ports, input({ email: 42 }))).status).toBe(400);
  });

  it("si la base o el envío fallan, nunca sale el email en el log", async () => {
    const { ports } = makePorts({ findToken: vi.fn(async () => { throw new Error("db caída con ana@x.com"); }) });
    const out = await requestUnsubscribeLink(ports, input({ workspace: "mi-negocio", email: "ana@x.com" }));
    await out.later?.();
    const logged = JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain("ana@x.com");
  });
});
