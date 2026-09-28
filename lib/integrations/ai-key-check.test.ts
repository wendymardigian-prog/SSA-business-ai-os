import { describe, it, expect, vi, afterEach } from "vitest";
import { checkAiProviderKey, isCheckableAiProvider } from "./ai-key-check";

/**
 * Nunca se llama al proveedor de verdad: todo pasa por un `fetchImpl` simulado.
 * Lo que se prueba es lo que decide si una key se guarda o no, mas dos cosas
 * que son faciles de romper sin darse cuenta: que la key no viaje por la URL y
 * que una caida del proveedor no bloquee el guardado.
 */

const KEY = "sk-ant-una-key-de-prueba-que-no-existe";

function fakeFetch(response: { status: number; body?: unknown } | Error) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    void url;
    void init;
    if (response instanceof Error) throw response;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body ?? {},
    } as Response;
  });
}

afterEach(() => vi.restoreAllMocks());

describe("isCheckableAiProvider", () => {
  it("los tres de texto se pueden probar; Voyage no", () => {
    expect(isCheckableAiProvider("anthropic")).toBe(true);
    expect(isCheckableAiProvider("openai")).toBe(true);
    expect(isCheckableAiProvider("google_ai")).toBe(true);
    // Voyage no publica un endpoint gratis para listar modelos.
    expect(isCheckableAiProvider("voyage")).toBe(false);
  });
});

describe("checkAiProviderKey — Anthropic", () => {
  it("pide los modelos con el header de version y sin paginar", async () => {
    const doFetch = fakeFetch({
      status: 200,
      body: { data: [{ id: "claude-sonnet-5" }, { id: "claude-opus-5" }] },
    });

    const result = await checkAiProviderKey({ providerId: "anthropic", apiKey: KEY, fetchImpl: doFetch });

    expect(result).toMatchObject({ ok: true, models: ["claude-sonnet-5", "claude-opus-5"] });
    const [url, init] = doFetch.mock.calls[0];
    expect(String(url)).toContain("limit=1000");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-api-key"]).toBe(KEY);
  });

  it("un 401 NO se guarda: es el caso que dejaba la card en verde", async () => {
    const doFetch = fakeFetch({
      status: 401,
      body: { type: "error", error: { type: "authentication_error", message: "API key is invalid." } },
    });

    const result = await checkAiProviderKey({ providerId: "anthropic", apiKey: KEY, fetchImpl: doFetch });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Anthropic");
    expect(result.error).toContain("401");
    // El mensaje se le muestra a una persona: nunca puede traer la key.
    expect(result.error).not.toContain(KEY);
  });

  it("un 403 se trata igual que un 401", async () => {
    const result = await checkAiProviderKey({
      providerId: "anthropic",
      apiKey: KEY,
      fetchImpl: fakeFetch({ status: 403 }),
    });
    expect(result.ok).toBe(false);
  });
});

describe("checkAiProviderKey — OpenAI", () => {
  it("deja solo los modelos con los que se puede conversar", async () => {
    const doFetch = fakeFetch({
      status: 200,
      body: {
        data: [
          { id: "gpt-5" },
          { id: "o3" },
          { id: "gpt-4o-audio-preview" },
          { id: "text-embedding-3-large" },
          { id: "dall-e-3" },
          { id: "whisper-1" },
          { id: "omni-moderation-latest" },
        ],
      },
    });

    const result = await checkAiProviderKey({ providerId: "openai", apiKey: "sk-x", fetchImpl: doFetch });

    expect(result).toMatchObject({ ok: true, models: ["gpt-5", "o3"] });
    const headers = (doFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-x");
  });
});

describe("checkAiProviderKey — Google", () => {
  it("filtra por generateContent y le saca el prefijo models/", async () => {
    const doFetch = fakeFetch({
      status: 200,
      body: {
        models: [
          { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
        ],
      },
    });

    const result = await checkAiProviderKey({ providerId: "google_ai", apiKey: "goog-key", fetchImpl: doFetch });

    expect(result).toMatchObject({ ok: true, models: ["gemini-2.5-flash", "gemini-2.5-pro"] });
  });

  it("la key va por header y NUNCA en la URL", async () => {
    const doFetch = fakeFetch({ status: 200, body: { models: [] } });

    await checkAiProviderKey({ providerId: "google_ai", apiKey: "goog-key", fetchImpl: doFetch });

    const [url, init] = doFetch.mock.calls[0];
    // Una URL con la key adentro termina en los logs del proxy.
    expect(String(url)).not.toContain("goog-key");
    expect((init as RequestInit).headers).toMatchObject({ "x-goog-api-key": "goog-key" });
  });
});

describe("checkAiProviderKey — cuando el proveedor no contesta", () => {
  it("un 429 deja guardar igual: no dice nada sobre la key", async () => {
    const result = await checkAiProviderKey({
      providerId: "anthropic",
      apiKey: KEY,
      fetchImpl: fakeFetch({ status: 429 }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models).toEqual([]);
    expect(result.detail).toContain("No se pudo verificar");
  });

  it("un 500 tampoco bloquea", async () => {
    const result = await checkAiProviderKey({
      providerId: "anthropic",
      apiKey: KEY,
      fetchImpl: fakeFetch({ status: 503 }),
    });
    expect(result).toMatchObject({ ok: true, models: [] });
  });

  it("sin red tampoco bloquea", async () => {
    const result = await checkAiProviderKey({
      providerId: "anthropic",
      apiKey: KEY,
      fetchImpl: fakeFetch(new Error("getaddrinfo ENOTFOUND")),
    });
    expect(result).toMatchObject({ ok: true, models: [] });
  });

  it("un cuerpo que no es JSON no rompe", async () => {
    const doFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token <");
      },
    }) as unknown as Response);

    const result = await checkAiProviderKey({ providerId: "anthropic", apiKey: KEY, fetchImpl: doFetch });
    expect(result).toMatchObject({ ok: true, models: [] });
  });

  it("una respuesta con forma inesperada devuelve lista vacia, no explota", async () => {
    const result = await checkAiProviderKey({
      providerId: "anthropic",
      apiKey: KEY,
      fetchImpl: fakeFetch({ status: 200, body: { data: "esto no es un array" } }),
    });
    expect(result).toMatchObject({ ok: true, models: [] });
  });
});

describe("checkAiProviderKey — proveedor sin prueba", () => {
  it("Voyage no llama a nadie y no opina", async () => {
    const doFetch = fakeFetch({ status: 200 });
    const result = await checkAiProviderKey({ providerId: "voyage", apiKey: "pa-x", fetchImpl: doFetch });

    expect(result).toMatchObject({ ok: true, models: [] });
    expect(doFetch).not.toHaveBeenCalled();
  });
});
