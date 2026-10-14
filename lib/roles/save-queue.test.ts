import { describe, expect, it } from "vitest";
import { createSaveQueue } from "./save-queue";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createSaveQueue", () => {
  it("corre los trabajos de a uno y en el orden en que se pidieron, sin perder ninguno", async () => {
    const q = createSaveQueue();
    const order: string[] = [];
    const job = (name: string, ms: number) => async () => {
      order.push(`${name}:inicio`);
      await delay(ms);
      order.push(`${name}:fin`);
      return name;
    };
    // El primero tarda MAS: sin cola, el segundo terminaria antes y lo pisaria.
    const results = await Promise.all([q.enqueue(job("a", 30)), q.enqueue(job("b", 1)), q.enqueue(job("c", 5))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["a:inicio", "a:fin", "b:inicio", "b:fin", "c:inicio", "c:fin"]);
  });

  it("un guardado que falla no frena a los que siguen, y cada uno recibe su resultado", async () => {
    const q = createSaveQueue();
    const first = q.enqueue(async () => {
      throw new Error("se cayó la red");
    });
    const second = q.enqueue(async () => "ok");
    await expect(first).rejects.toThrow("se cayó la red");
    await expect(second).resolves.toBe("ok");
  });

  it("cuenta lo pendiente y avisa cuando cambia", async () => {
    const seen: number[] = [];
    const q = createSaveQueue((n) => seen.push(n));
    const a = q.enqueue(() => delay(5));
    const b = q.enqueue(() => delay(5));
    expect(q.pending()).toBe(2);
    await Promise.all([a, b]);
    expect(q.pending()).toBe(0);
    expect(seen).toEqual([1, 2, 1, 0]);
  });
});
