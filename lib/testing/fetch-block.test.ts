/**
 * Los tests no hablan con la red (`vitest.setup.ts`): un `fetch` real falla
 * ruidoso, y un test que lo necesita lo simula como siempre.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("fetch bloqueado en los tests", () => {
  it("un pedido real falla diciendo cual era", async () => {
    await expect(fetch("https://api.ejemplo.test/v1/posts")).rejects.toThrow(
      "[tests] fetch real bloqueado: https://api.ejemplo.test/v1/posts",
    );
  });

  it("tambien con una URL o un Request", async () => {
    await expect(fetch(new URL("https://api.ejemplo.test/a"))).rejects.toThrow("api.ejemplo.test/a");
    await expect(fetch(new Request("https://api.ejemplo.test/b"))).rejects.toThrow("api.ejemplo.test/b");
  });

  it("un test que lo simula sigue funcionando", async () => {
    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
    const res = await fetch("https://api.ejemplo.test/v1/posts");
    expect(await res.text()).toBe("ok");
  });

  it("y al terminar vuelve el bloqueo", async () => {
    vi.stubGlobal("fetch", async () => new Response("ok"));
    vi.unstubAllGlobals();
    await expect(fetch("https://api.ejemplo.test/c")).rejects.toThrow("fetch real bloqueado");
  });
});
