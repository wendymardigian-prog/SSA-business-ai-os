import { describe, expect, it, vi } from "vitest";
import { chatBlockCache, chatBlockCacheKey, createBlockCache } from "./block-cache";
import type { BlockResult } from "./types";

const good = (data: number): BlockResult<number> => ({ ok: true, data, loadedAt: "2026-11-06T00:00:00.000Z" });
const bad: BlockResult<number> = { ok: false, error: "se cayo" };

function clock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createBlockCache", () => {
  it("la segunda lectura no vuelve a consultar", async () => {
    const cache = createBlockCache();
    const load = vi.fn(async () => good(1));
    await cache.get("k", load);
    await expect(cache.get("k", load)).resolves.toEqual(good(1));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("vence a los ttl", async () => {
    const c = clock();
    const cache = createBlockCache({ ttlMs: 100, now: c.now });
    const load = vi.fn(async () => good(1));
    await cache.get("k", load);
    c.advance(99);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(1);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("no guarda un error: se puede reintentar enseguida", async () => {
    const cache = createBlockCache();
    const load = vi.fn<() => Promise<BlockResult<number>>>().mockResolvedValueOnce(bad).mockResolvedValueOnce(good(2));
    await expect(cache.get("k", load)).resolves.toEqual(bad);
    await expect(cache.get("k", load)).resolves.toEqual(good(2));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("dos pedidos a la vez comparten la misma consulta", async () => {
    const cache = createBlockCache();
    let finish!: (value: BlockResult<number>) => void;
    const load = vi.fn(() => new Promise<BlockResult<number>>((resolve) => (finish = resolve)));
    const a = cache.get("k", load);
    const b = cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(1);
    finish(good(3));
    await expect(Promise.all([a, b])).resolves.toEqual([good(3), good(3)]);
  });

  it("una consulta que termino ya no cuenta como en curso", async () => {
    const cache = createBlockCache();
    const load = vi.fn<() => Promise<BlockResult<number>>>().mockResolvedValue(bad);
    await cache.get("k", load);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("minStoredAt hace vencer lo anterior a la marca", async () => {
    const c = clock(1000);
    const cache = createBlockCache({ now: c.now });
    const load = vi.fn(async () => good(1));
    await cache.get("k", load);
    await cache.get("k", load, { minStoredAt: 1000 });
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(10);
    await cache.get("k", load, { minStoredAt: 1005 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("minStoredAt tampoco comparte una consulta empezada antes de la marca", async () => {
    const c = clock(1000);
    const cache = createBlockCache({ now: c.now });
    const load = vi.fn(() => new Promise<BlockResult<number>>(() => {}));
    void cache.get("k", load);
    c.advance(10);
    void cache.get("k", load, { minStoredAt: 1005 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("skipStored ignora lo guardado pero se suma a lo que esta en curso", async () => {
    const cache = createBlockCache();
    const first = vi.fn(async () => good(1));
    await cache.get("k", first);

    let finish!: (value: BlockResult<number>) => void;
    const second = vi.fn(() => new Promise<BlockResult<number>>((resolve) => (finish = resolve)));
    const a = cache.get("k", second, { skipStored: true });
    const b = cache.get("k", second, { skipStored: true });
    expect(second).toHaveBeenCalledTimes(1);
    finish(good(2));
    await expect(Promise.all([a, b])).resolves.toEqual([good(2), good(2)]);
  });

  it("no pasa del maximo y saca la que hace mas que no se usa", async () => {
    const cache = createBlockCache({ maxEntries: 2 });
    const load = vi.fn(async () => good(1));
    await cache.get("a", load);
    await cache.get("b", load);
    await cache.get("a", load); // "a" pasa a ser la mas reciente
    await cache.get("c", load); // sale "b"
    expect(cache.size).toBe(2);
    load.mockClear();
    await cache.get("a", load);
    expect(load).not.toHaveBeenCalled();
    await cache.get("b", load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("chatBlockCacheKey", () => {
  const base = {
    userId: "u1",
    workspaceId: "w1",
    block: "cards",
    channel: null,
    author: null,
    rangeFrom: "2026-10-08T06:00:00.000Z",
    rangeTo: null,
    timezone: "America/Costa_Rica",
  };

  it("dos personas nunca comparten una entrada", () => {
    expect(chatBlockCacheKey(base)).not.toBe(chatBlockCacheKey({ ...base, userId: "u2" }));
  });

  it("cambia con cada cosa que cambia el resultado", () => {
    const key = chatBlockCacheKey(base);
    expect(chatBlockCacheKey({ ...base, workspaceId: "w2" })).not.toBe(key);
    expect(chatBlockCacheKey({ ...base, block: "trends" })).not.toBe(key);
    expect(chatBlockCacheKey({ ...base, channel: "c1" })).not.toBe(key);
    expect(chatBlockCacheKey({ ...base, author: "agent" })).not.toBe(key);
    expect(chatBlockCacheKey({ ...base, rangeFrom: "2026-10-09T06:00:00.000Z" })).not.toBe(key);
    expect(chatBlockCacheKey({ ...base, timezone: "UTC" })).not.toBe(key);
  });

  it("un valor no se puede disfrazar de otro campo", () => {
    expect(chatBlockCacheKey({ ...base, channel: "a", author: null })).not.toBe(
      chatBlockCacheKey({ ...base, channel: null, author: "a" }),
    );
  });
});

describe("chatBlockCache", () => {
  it("es una sola por proceso", () => {
    expect(chatBlockCache()).toBe(chatBlockCache());
  });
});
