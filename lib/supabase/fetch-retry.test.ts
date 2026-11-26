/**
 * El reintento de los cortes de red a Supabase (26/11/2026: ERR_HTTP2_GOAWAY_SESSION).
 * Todo con un `fetch` simulado: ningun test sale a la red.
 */

import { describe, it, expect, vi } from "vitest";
import { createRetryingFetch, isRetryableNetworkError, RETRY_DELAYS_MS } from "./fetch-retry";

/** El error que lanza Node cuando la conexion HTTP/2 ya fue cerrada por el servidor. */
function goaway(): TypeError {
  const cause = Object.assign(new Error("New streams cannot be created after receiving a GOAWAY"), {
    code: "ERR_HTTP2_GOAWAY_SESSION",
  });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

function reset(): TypeError {
  const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

const ok = () => new Response("{}", { status: 200 });
const noSleep = async () => {};

describe("isRetryableNetworkError", () => {
  it("un GOAWAY se reintenta en cualquier metodo (el pedido no se proceso)", () => {
    expect(isRetryableNetworkError(goaway(), "POST")).toBe(true);
    expect(isRetryableNetworkError(goaway(), "GET")).toBe(true);
  });

  it("otros cortes se reintentan solo en GET y HEAD", () => {
    expect(isRetryableNetworkError(reset(), "GET")).toBe(true);
    expect(isRetryableNetworkError(reset(), "HEAD")).toBe(true);
    expect(isRetryableNetworkError(reset(), "POST")).toBe(false);
  });

  it("una cancelacion nunca se reintenta", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(isRetryableNetworkError(abort, "GET")).toBe(false);
  });

  it("un error que no es de red no se reintenta", () => {
    expect(isRetryableNetworkError(new Error("boom"), "GET")).toBe(false);
    expect(isRetryableNetworkError("texto", "GET")).toBe(false);
  });
});

describe("createRetryingFetch", () => {
  it("con un GOAWAY en el primer intento, el segundo sale y quien llama no se entera", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(goaway()).mockResolvedValueOnce(ok());
    const retrying = createRetryingFetch({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    const res = await retrying("https://x.test/rest/v1/messages", { method: "POST", body: "{}" });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("espera entre intentos segun la tabla de esperas", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(goaway()).mockRejectedValueOnce(goaway()).mockResolvedValueOnce(ok());
    const sleep = vi.fn(async (_ms: number) => {});
    const retrying = createRetryingFetch({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep });

    await retrying("https://x.test/a", { method: "POST" });

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([...RETRY_DELAYS_MS]);
  });

  it("si sigue fallando despues de los reintentos, lanza el mismo error de siempre", async () => {
    const error = goaway();
    const fetchImpl = vi.fn().mockRejectedValue(error);
    const retrying = createRetryingFetch({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await expect(retrying("https://x.test/a", { method: "POST" })).rejects.toBe(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length);
  });

  it("un corte que no es seguro en un POST no se repite (podria escribir dos veces)", async () => {
    const error = reset();
    const fetchImpl = vi.fn().mockRejectedValue(error);
    const retrying = createRetryingFetch({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    await expect(retrying("https://x.test/a", { method: "POST", body: "{}" })).rejects.toBe(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("un GET con la conexion reseteada si se reintenta", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(reset()).mockResolvedValueOnce(ok());
    const retrying = createRetryingFetch({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    const res = await retrying("https://x.test/a");

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("una respuesta con error (400, 500) no se reintenta: solo los cortes de red", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    const retrying = createRetryingFetch({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    const res = await retrying("https://x.test/a");

    expect(res.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
