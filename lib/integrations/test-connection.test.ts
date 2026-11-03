import { describe, it, expect, vi } from "vitest";
import { testConnection } from "./test-connection";

/**
 * Lo que decide si una integracion se guarda o no.
 *
 * El caso que importa es el de IA: hasta la Etapa 2 caian todas en el `default`
 * y se guardaban siempre, asi que una key revocada dejaba la card en verde y la
 * falla aparecia recien cuando un lead escribia. Paso de verdad.
 */

function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as Response,
  );
}

describe("testConnection — proveedores de IA", () => {
  it("una key invalida NO deja guardar", async () => {
    const result = await testConnection({
      providerId: "anthropic",
      secrets: { api_key: "sk-ant-revocada" },
      config: {},
      fetchImpl: fakeFetch(401, { error: { type: "authentication_error" } }),
    });

    expect(result.ok).toBe(false);
  });

  it("una key buena guarda la lista de modelos que vio el proveedor", async () => {
    const result = await testConnection({
      providerId: "anthropic",
      secrets: { api_key: "sk-ant-buena" },
      config: {},
      fetchImpl: fakeFetch(200, { data: [{ id: "claude-sonnet-5" }, { id: "claude-fable-5-1" }] }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config?.models).toEqual(["claude-sonnet-5", "claude-fable-5-1"]);
    expect(result.config?.models_checked_at).toEqual(expect.any(String));
  });

  it("sin key nueva no prueba nada: se esta editando el modelo por defecto", async () => {
    const doFetch = fakeFetch(200, {});

    const result = await testConnection({
      providerId: "anthropic",
      secrets: {},
      config: { default_model: "claude-opus-5" },
      fetchImpl: doFetch,
    });

    expect(result).toEqual({ ok: true });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("si el proveedor esta caido, se guarda igual y sin lista", async () => {
    const result = await testConnection({
      providerId: "openai",
      secrets: { api_key: "sk-algo" },
      config: {},
      fetchImpl: fakeFetch(503, {}),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sin modelos no se pisa lo que ya habia guardado.
    expect(result.config).toBeUndefined();
  });
});

describe("testConnection — las que no se prueban", () => {
  it("Voyage se guarda sin llamar a nadie", async () => {
    const doFetch = fakeFetch(200, {});
    const result = await testConnection({
      providerId: "voyage",
      secrets: { api_key: "pa-x" },
      config: {},
      fetchImpl: doFetch,
    });

    expect(result).toEqual({ ok: true });
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe("testConnection — Resend (conexion de Resend)", () => {
  const run = (doFetch: ReturnType<typeof fakeFetch>, apiKey = "re_abcdefghijklmnopqrstuv") =>
    testConnection({ providerId: "resend", secrets: apiKey ? { api_key: apiKey } : {}, config: {}, fetchImpl: doFetch as never });

  it("key de acceso completo: se guarda marcada `full`, con una lectura (GET /domains)", async () => {
    const doFetch = fakeFetch(200, { data: [] });
    expect(await run(doFetch)).toEqual({ ok: true, detail: "Conectada · acceso completo.", config: { access: "full" } });
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/domains");
    expect(init.method).toBe("GET");
  });

  it("key de solo envio (401 restricted_api_key): se guarda igual, marcada `sending`", async () => {
    expect(await run(fakeFetch(401, { name: "restricted_api_key" }))).toEqual({ ok: true, detail: "Conectada · solo envío.", config: { access: "sending" } });
  });

  it("key revocada o mal copiada: NO se guarda", async () => {
    const result = await run(fakeFetch(401, { name: "validation_error" }));
    expect(result.ok).toBe(false);
  });

  it("Resend caido: se guarda (la caida no dice nada de la key)", async () => {
    expect((await run(fakeFetch(503, {}))).ok).toBe(true);
  });

  it("sin key nueva no llama a nadie (se esta editando otra cosa)", async () => {
    const doFetch = fakeFetch(200, {});
    expect(await run(doFetch, "")).toEqual({ ok: true });
    expect(doFetch).not.toHaveBeenCalled();
  });
});
