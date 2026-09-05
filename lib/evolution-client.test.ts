import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EvolutionError,
  createInstance,
  deleteInstance,
  getConnectionState,
  getMajorVersion,
  getQrCode,
  instanceNameFor,
  listInstanceNames,
  resetVersionCache,
  sendText,
  type EvolutionConfig,
} from "./evolution-client";

const config: EvolutionConfig = {
  baseUrl: "https://evo.test",
  apiKey: "clave-global",
  instancePrefix: "ssa",
};

/** Cola de respuestas: cada fetch consume la siguiente. */
function mockFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; method: string; body: any; headers: any }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body as string) : undefined,
      headers: init.headers,
    });
    const next = responses.shift() ?? { status: 200, body: {} };
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (next.body === undefined ? "" : JSON.stringify(next.body)),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const v2 = { body: { version: "2.1.1" } };
const v1 = { body: { version: "1.7.4" } };

beforeEach(() => resetVersionCache());
afterEach(() => vi.unstubAllGlobals());

describe("configuracion", () => {
  it("le pone prefijo propio a la instancia para no chocar con otro sistema", () => {
    expect(instanceNameFor(config, "280223ad-6bbc-4620-8c65-20f302a7c249")).toBe("ssa-280223ad");
  });
});

describe("deteccion de version", () => {
  it("detecta v1 y v2, y la pregunta una sola vez", async () => {
    mockFetch([v2]);
    expect(await getMajorVersion(config)).toBe(2);
    expect(await getMajorVersion(config)).toBe(2);
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);

    resetVersionCache();
    mockFetch([v1]);
    expect(await getMajorVersion(config)).toBe(1);
  });

  it("asume v2 si el servidor no dice su version", async () => {
    mockFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    expect(await getMajorVersion(config)).toBe(2);
  });
});

describe("sendText", () => {
  it("usa el cuerpo que espera cada version", async () => {
    let calls = mockFetch([v2, { body: { key: { id: "MSG1" } } }]);
    const res = await sendText(config, "ssa-abc", "+54 9 11 2233-4455", "hola");
    expect(res.id).toBe("MSG1");
    expect(calls[1].url).toBe("https://evo.test/message/sendText/ssa-abc");
    expect(calls[1].body).toEqual({ number: "5491122334455", text: "hola" });

    resetVersionCache();
    calls = mockFetch([v1, { body: { key: { id: "MSG2" } } }]);
    await sendText(config, "ssa-abc", "5491122334455@s.whatsapp.net", "hola");
    expect(calls[1].body).toEqual({ number: "5491122334455", textMessage: { text: "hola" } });
  });

  it("no llama a Evolution con un numero invalido", async () => {
    mockFetch([v2]);
    await expect(sendText(config, "ssa-abc", "1234", "hola")).rejects.toThrow(/invalido/);
  });

  it("manda la apikey en el header, nunca en la URL", async () => {
    const calls = mockFetch([v2, { body: {} }]);
    await sendText(config, "ssa-abc", "+5491122334455", "hola");
    expect(calls[1].headers.apikey).toBe("clave-global");
    expect(calls[1].url).not.toContain("clave-global");
  });
});

describe("reintentos", () => {
  it("reintenta ante un 500 y termina bien", async () => {
    const calls = mockFetch([v2, { status: 500 }, { body: { key: { id: "OK" } } }]);
    const res = await sendText(config, "ssa-abc", "+5491122334455", "hola");
    expect(res.id).toBe("OK");
    expect(calls.length).toBe(3);
  });

  it("no reintenta ante un 400: reintentar no arregla un pedido mal armado", async () => {
    const calls = mockFetch([v2, { status: 400, body: { message: "numero invalido" } }]);
    await expect(sendText(config, "ssa-abc", "+5491122334455", "hola")).rejects.toThrow(
      EvolutionError
    );
    expect(calls.length).toBe(2);
  });

  it("se rinde despues de 3 intentos", async () => {
    const calls = mockFetch([v2, { status: 502 }, { status: 502 }, { status: 502 }]);
    await expect(sendText(config, "ssa-abc", "+5491122334455", "hola")).rejects.toThrow(/502/);
    expect(calls.length).toBe(4);
  });
});

describe("estado de la conexion", () => {
  it("normaliza el estado venga donde venga", async () => {
    mockFetch([{ body: { instance: { state: "open" } } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("open");

    mockFetch([{ body: { state: "connecting" } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("connecting");

    mockFetch([{ body: { connectionStatus: "close" } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("close");

    mockFetch([{ body: { algo: "raro" } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("unknown");
  });

  it("una instancia que ya no existe cuenta como desconectada", async () => {
    mockFetch([{ status: 404, body: { message: "not found" } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("close");
  });
});

describe("creacion de instancia", () => {
  it("crear una que ya existe no es un error, y reconfigura el webhook", async () => {
    const calls = mockFetch([
      v2,
      { status: 403, body: { message: "This name ssa-abc is already in use." } },
      { body: { webhook: {} } },
    ]);
    await createInstance(config, "ssa-abc", "https://x.test/hook", "token123");

    const webhookCall = calls.find((c) => c.url.includes("/webhook/set/"));
    expect(webhookCall).toBeDefined();
    expect(webhookCall!.body.webhook.url).toBe("https://x.test/hook");
    // El token va en un header del webhook: es lo unico que separa un evento
    // real de cualquiera que descubra la URL publica.
    expect(webhookCall!.body.webhook.headers["x-webhook-token"]).toBe("token123");
    expect(webhookCall!.body.webhook.events).toContain("MESSAGES_UPSERT");
    expect(webhookCall!.body.webhook.events).toContain("CONNECTION_UPDATE");
  });

  it("un 403 que no es 'ya existe' si es un error", async () => {
    mockFetch([v2, { status: 403, body: { message: "unauthorized" } }]);
    await expect(
      createInstance(config, "ssa-abc", "https://x.test/hook", "t")
    ).rejects.toThrow(EvolutionError);
  });
});

describe("borrado de instancia", () => {
  it("se niega a borrar una instancia sin nuestro prefijo", async () => {
    // Este Evolution esta compartido con otro sistema: borrar la instancia
    // equivocada le corta WhatsApp a otro producto.
    mockFetch([]);
    await expect(deleteInstance(config, "crm-produccion")).rejects.toThrow(/prefijo/);
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });

  it("borra la propia", async () => {
    const calls = mockFetch([{ body: {} }]);
    await deleteInstance(config, "ssa-abc");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("https://evo.test/instance/delete/ssa-abc");
  });
});

describe("lecturas", () => {
  it("lista los nombres de instancia en los dos formatos de respuesta", async () => {
    mockFetch([{ body: [{ instance: { instanceName: "a" } }, { name: "b" }] }]);
    expect(await listInstanceNames(config)).toEqual(["a", "b"]);

    mockFetch([{ body: { instances: [{ instanceName: "c" }] } }]);
    expect(await listInstanceNames(config)).toEqual(["c"]);
  });

  it("saca el QR este anidado o no", async () => {
    mockFetch([{ body: { qrcode: { base64: "data:image/png;base64,AAA", code: "1@x" } } }]);
    expect(await getQrCode(config, "ssa-abc")).toEqual({
      base64: "data:image/png;base64,AAA",
      code: "1@x",
      pairingCode: null,
    });

    mockFetch([{ body: { base64: "data:image/png;base64,BBB", pairingCode: "ABCD-1234" } }]);
    expect(await getQrCode(config, "ssa-abc")).toEqual({
      base64: "data:image/png;base64,BBB",
      code: null,
      pairingCode: "ABCD-1234",
    });
  });
});
