import { describe, it, expect, vi } from "vitest";
import { CAPI_GRAPH_VERSION, probeCapiPixel, sendCapiEvents } from "./send";
import type { MetaServerEvent } from "./build-event";

const EVENT: MetaServerEvent = {
  event_name: "Lead",
  event_time: 1_700_000_000,
  event_id: "form.s1",
  action_source: "system_generated",
  user_data: { em: ["x"] },
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("mandar eventos", () => {
  it("POST al Pixel, con el token en el cuerpo (nunca en la URL) y el código de prueba si hay", async () => {
    const fetchImpl = respond(200, { events_received: 1, fbtrace_id: "trace" });
    const result = await sendCapiEvents({ pixelId: "1234567890", token: "TOKEN", events: [EVENT], testEventCode: "TEST1", fetchImpl });
    expect(result).toEqual({ ok: true, eventsReceived: 1, fbtraceId: "trace" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/${CAPI_GRAPH_VERSION}/1234567890/events`);
    expect(url).not.toContain("TOKEN");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ data: [EVENT], access_token: "TOKEN", test_event_code: "TEST1" });
  });

  it("un límite de uso o un 5xx se reintenta; un dato inválido, no", async () => {
    const limited = await sendCapiEvents({ pixelId: "1234567890", token: "T", events: [EVENT], fetchImpl: respond(400, { error: { code: 17, message: "limit" } }) });
    expect(limited).toMatchObject({ ok: false, transient: true });
    const down = await sendCapiEvents({ pixelId: "1234567890", token: "T", events: [EVENT], fetchImpl: respond(503, {}) });
    expect(down).toMatchObject({ ok: false, transient: true });
    const invalid = await sendCapiEvents({ pixelId: "1234567890", token: "T", events: [EVENT], fetchImpl: respond(400, { error: { code: 100, message: "Invalid parameter" } }) });
    expect(invalid).toMatchObject({ ok: false, transient: false, code: 100 });
    const dead = await sendCapiEvents({ pixelId: "1234567890", token: "T", events: [EVENT], fetchImpl: respond(400, { error: { code: 190, type: "OAuthException" } }) });
    expect(dead).toMatchObject({ ok: false, transient: false });
    expect(dead.ok ? "" : dead.error).toContain("token");
  });

  it("la red caída es pasajera y nunca lanza", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await sendCapiEvents({ pixelId: "1234567890", token: "T", events: [EVENT], fetchImpl })).toMatchObject({ ok: false, transient: true });
  });

  it("un Pixel mal escrito no llega a Meta", async () => {
    const fetchImpl = respond(200, {});
    expect(await sendCapiEvents({ pixelId: "abc", token: "T", events: [EVENT], fetchImpl })).toMatchObject({ ok: false, transient: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("si Meta dice que recibió menos eventos de los que se mandaron, no cuenta como enviado", async () => {
    const result = await sendCapiEvents({ pixelId: "1234567890", token: "T", events: [EVENT], fetchImpl: respond(200, { events_received: 0 }) });
    expect(result.ok).toBe(false);
  });
});

describe("probar el Pixel", () => {
  it("con el token que sirve, devuelve su nombre", async () => {
    expect(await probeCapiPixel("1234567890", "T", respond(200, { id: "1234567890", name: "Pixel del negocio" }) as unknown as typeof fetch)).toEqual({ ok: true, name: "Pixel del negocio" });
  });

  it("un token sin acceso a ese Pixel no se guarda", async () => {
    const result = await probeCapiPixel("1234567890", "T", respond(400, { error: { code: 100, message: "Unsupported get request" } }) as unknown as typeof fetch);
    expect(result.ok).toBe(false);
  });
});
