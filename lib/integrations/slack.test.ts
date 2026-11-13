import { afterEach, describe, expect, it, vi } from "vitest";
import { authTest, isSlackUserId, postMessage, slackErrorMessage, slackNotificationText } from "./slack";

const TOKEN = "xoxb-1234567890-abcdefghij";

function fakeFetch(response: { status?: number; body?: unknown; throws?: boolean }) {
  return vi.fn(async () => {
    if (response.throws) throw new Error("network");
    return new Response(JSON.stringify(response.body ?? {}), { status: response.status ?? 200 });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("authTest", () => {
  it("devuelve el espacio de trabajo con un token bueno", async () => {
    const f = fakeFetch({ body: { ok: true, team: "Mi negocio" } });
    expect(await authTest(TOKEN, f)).toEqual({ ok: true, team: "Mi negocio" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://slack.com/api/auth.test");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });
  it("rechaza sin llamar un token que no es de bot", async () => {
    const f = fakeFetch({ body: { ok: true } });
    const r = await authTest("xoxp-otro", f);
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("traduce un token inválido y lo marca", async () => {
    const r = await authTest(TOKEN, fakeFetch({ body: { ok: false, error: "invalid_auth" } }));
    expect(r).toMatchObject({ ok: false, invalidToken: true, temporary: false });
  });
  it("un error de red es temporal", async () => {
    expect(await authTest(TOKEN, fakeFetch({ throws: true }))).toMatchObject({ ok: false, temporary: true });
    expect(await authTest(TOKEN, fakeFetch({ status: 503 }))).toMatchObject({ ok: false, temporary: true });
  });
});

describe("postMessage", () => {
  it("manda a una persona por su ID", async () => {
    const f = fakeFetch({ body: { ok: true, ts: "123.45" } });
    expect(await postMessage(TOKEN, "U0123ABC", "Hola", f)).toEqual({ ok: true, ts: "123.45" });
    const body = JSON.parse(((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string));
    expect(body).toMatchObject({ channel: "U0123ABC", text: "Hola" });
  });
  it("no llama con un ID mal formado ni con el texto vacío", async () => {
    const f = fakeFetch({ body: { ok: true } });
    expect((await postMessage(TOKEN, "juan", "Hola", f)).ok).toBe(false);
    expect((await postMessage(TOKEN, "U0123ABC", "   ", f)).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("traduce los errores de Slack", async () => {
    const r = await postMessage(TOKEN, "C0123ABC", "Hola", fakeFetch({ body: { ok: false, error: "not_in_channel" } }));
    expect(r).toMatchObject({ ok: false, error: slackErrorMessage("not_in_channel") });
  });
});

describe("nunca loguea", () => {
  it("no escribe el token, el ID ni el texto en la consola", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    await postMessage(TOKEN, "U0123ABC", "secreto", fakeFetch({ body: { ok: false, error: "invalid_auth" } }));
    await authTest(TOKEN, fakeFetch({ throws: true }));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("ayudas", () => {
  it("valida el ID de una persona", () => {
    expect(isSlackUserId("U0123ABC")).toBe(true);
    expect(isSlackUserId("W12")).toBe(true);
    expect(isSlackUserId("u0123")).toBe(false);
    expect(isSlackUserId("C0123ABC")).toBe(false);
  });
  it("arma el texto del aviso", () => {
    expect(slackNotificationText({ title: "Hola", body: "cuerpo", url: "https://x.test/a" })).toBe("*Hola*\ncuerpo\nhttps://x.test/a");
  });
});
