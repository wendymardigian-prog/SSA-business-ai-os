import { describe, expect, it, vi } from "vitest";
import { MemoryDb } from "../testing/memory-db";
import { NOT_FOUND_MIN_MS, PUBLIC_LIMITS, padNotFound, remainingDelay, withinPublicLimit } from "./guard";

describe("tope por IP", () => {
  const headers = (ip: string) => new Headers({ "x-real-ip": ip });

  it("120 por minuto a la página: el 121 se frena", async () => {
    const db = new MemoryDb();
    let count = 0;
    db.rpcs.bump_rate_limit = () => ++count;
    expect(PUBLIC_LIMITS.page).toBe(120);
    const results: boolean[] = [];
    for (let i = 0; i < 121; i++) results.push(await withinPublicLimit(db.client, headers("203.0.113.9"), "page"));
    expect(results.slice(0, 120).every(Boolean)).toBe(true);
    expect(results[120]).toBe(false);
  });

  it("la clave es de cada parte y lleva la IP hasheada, nunca la IP", async () => {
    const db = new MemoryDb();
    db.rpcs.bump_rate_limit = () => 1;
    await withinPublicLimit(db.client, headers("203.0.113.9"), "page");
    await withinPublicLimit(db.client, headers("203.0.113.9"), "image");
    const keys = db.rpcCalls.map((c) => String(c.args.p_key));
    expect(keys[0]).toMatch(/^designer:page:[0-9a-f]{32}$/);
    expect(keys[1]).toMatch(/^designer:image:[0-9a-f]{32}$/);
    expect(keys.join()).not.toContain("203.0.113.9");
  });

  it("las imágenes tienen un tope más alto que la página (una pieza tiene hasta 20)", () => {
    expect(PUBLIC_LIMITS.image).toBeGreaterThan(PUBLIC_LIMITS.page);
  });

  it("si la base no responde, no se bloquea a nadie", async () => {
    const db = new MemoryDb();
    db.failures.set("rpc.bump_rate_limit", "caída");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await withinPublicLimit(db.client, headers("203.0.113.9"), "page")).toBe(true);
    spy.mockRestore();
  });
});

describe("un 404 que no delata nada por el tiempo", () => {
  it("espera lo que falta hasta el mínimo, nunca de más", () => {
    expect(remainingDelay(0)).toBe(NOT_FOUND_MIN_MS);
    expect(remainingDelay(40)).toBe(NOT_FOUND_MIN_MS - 40);
    expect(remainingDelay(NOT_FOUND_MIN_MS)).toBe(0);
    expect(remainingDelay(5_000)).toBe(0);
    expect(remainingDelay(-10)).toBe(NOT_FOUND_MIN_MS);
  });

  it("un código inexistente y uno que tardó más salen en tiempos parecidos", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    await padNotFound(1000, { now: () => 1010, sleep });
    await padNotFound(1000, { now: () => 1090, sleep });
    await padNotFound(1000, { now: () => 1500, sleep });
    // Lo que tarda la respuesta + la espera es lo mismo (≥ mínimo) para los dos primeros; el tercero ya pasó el mínimo.
    expect(10 + waits[0]).toBe(NOT_FOUND_MIN_MS);
    expect(90 + waits[1]).toBe(NOT_FOUND_MIN_MS);
    expect(waits).toHaveLength(2);
  });
});
