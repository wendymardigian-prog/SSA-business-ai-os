import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUSY_MESSAGE, CHAT_QUERY_RETRY_DELAY_MS, chatQuery, GENERIC_MESSAGE, TIMEOUT_MESSAGE } from "./rpc";
import { createQueryLimiter, QueueDeadlineError, type QueryLimiter } from "./query-limiter";

const timeoutError = { message: "canceling statement due to statement timeout", code: "57014" };

describe("chatQuery", () => {
  let logged: ReturnType<typeof vi.spyOn>;
  const sleep = vi.fn(async () => {});
  const deps = () => ({ limiter: createQueryLimiter(4), sleep });

  beforeEach(() => {
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sleep.mockClear();
  });
  afterEach(() => {
    logged.mockRestore();
  });

  it("devuelve los datos tal cual", async () => {
    const r = await chatQuery("x", async () => ({ data: [1], error: null, count: 3 }), deps());
    expect(r).toEqual({ data: [1], error: null, count: 3 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("un corte por tiempo se reintenta una vez, y si anda no se nota", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: timeoutError })
      .mockResolvedValueOnce({ data: [2], error: null });
    const r = await chatQuery("x", run, deps());
    expect(r.data).toEqual([2]);
    expect(r.error).toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(CHAT_QUERY_RETRY_DELAY_MS);
  });

  it("dos cortes seguidos dan un texto claro, nunca el de la base", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: timeoutError });
    const r = await chatQuery("x", run, deps());
    expect(run).toHaveBeenCalledTimes(2);
    expect(r.error?.message).toBe(TIMEOUT_MESSAGE);
    expect(r.error?.message).not.toContain("statement");
  });

  it("otro error no se reintenta y tampoco muestra el texto de la base", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: { message: "function chat_x does not exist", code: "42883" } });
    const r = await chatQuery("x", run, deps());
    expect(run).toHaveBeenCalledTimes(1);
    expect(r.error?.message).toBe(GENERIC_MESSAGE);
    expect(logged).toHaveBeenCalled();
  });

  it("nunca lanza, aunque se rompa la red", async () => {
    const r = await chatQuery("x", () => Promise.reject(new Error("fetch failed")), deps());
    expect(r.error?.message).toBe(GENERIC_MESSAGE);
  });

  it("lo que vencio en la cola avisa que hay espera", async () => {
    const limiter: QueryLimiter = { run: () => Promise.reject(new QueueDeadlineError()), active: 0, queued: 0 };
    const r = await chatQuery("x", async () => ({ data: 1, error: null }), { limiter, sleep });
    expect(r.error?.message).toBe(BUSY_MESSAGE);
  });

  it("no ocupa un lugar de la cola mientras espera para reintentar", async () => {
    const limiter = createQueryLimiter(1);
    let activeDuringSleep = -1;
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: timeoutError })
      .mockResolvedValueOnce({ data: 1, error: null });
    await chatQuery("x", run, {
      limiter,
      sleep: async () => {
        activeDuringSleep = limiter.active;
      },
    });
    expect(activeDuringSleep).toBe(0);
  });
});
