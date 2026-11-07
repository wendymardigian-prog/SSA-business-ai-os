import { describe, expect, it } from "vitest";
import { chatQueryLimiter, createQueryLimiter, QueueDeadlineError } from "./query-limiter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("createQueryLimiter", () => {
  it("nunca corre mas tareas que el maximo", async () => {
    const limiter = createQueryLimiter(2);
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    const started: number[] = [];
    const runs = gates.map((g, i) =>
      limiter.run(() => {
        started.push(i);
        return g.promise;
      }),
    );

    await flush();
    expect(started).toEqual([0, 1]);
    expect(limiter.active).toBe(2);
    expect(limiter.queued).toBe(1);

    gates[0].resolve(0);
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve(1);
    gates[2].resolve(2);
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2]);
    expect(limiter.active).toBe(0);
  });

  it("corre en el orden en que se pidieron", async () => {
    const limiter = createQueryLimiter(1);
    const order: string[] = [];
    await Promise.all(
      ["cifras", "tendencias", "agente"].map((name) =>
        limiter.run(async () => {
          order.push(name);
        }),
      ),
    );
    expect(order).toEqual(["cifras", "tendencias", "agente"]);
  });

  it("una tarea que falla libera su lugar", async () => {
    const limiter = createQueryLimiter(1);
    const failed = limiter.run(() => Promise.reject(new Error("se cayo")));
    const next = limiter.run(async () => "sigue");
    await expect(failed).rejects.toThrow("se cayo");
    await expect(next).resolves.toBe("sigue");
    expect(limiter.active).toBe(0);
  });

  it("lo que espero demasiado se descarta sin correr", async () => {
    let clock = 0;
    const limiter = createQueryLimiter(1, () => clock);
    const gate = deferred<void>();
    let ranLate = false;

    const first = limiter.run(() => gate.promise);
    const late = limiter.run(
      async () => {
        ranLate = true;
      },
      { maxWaitMs: 100 },
    );

    clock = 101;
    gate.resolve();
    await first;
    await expect(late).rejects.toBeInstanceOf(QueueDeadlineError);
    expect(ranLate).toBe(false);
  });

  it("una tarea vencida no frena a la que sigue", async () => {
    let clock = 0;
    const limiter = createQueryLimiter(1, () => clock);
    const gate = deferred<void>();

    const first = limiter.run(() => gate.promise);
    const late = limiter.run(async () => "no", { maxWaitMs: 10 });
    const fine = limiter.run(async () => "si", { maxWaitMs: 1000 });

    clock = 50;
    gate.resolve();
    await first;
    await expect(late).rejects.toBeInstanceOf(QueueDeadlineError);
    await expect(fine).resolves.toBe("si");
  });
});

describe("chatQueryLimiter", () => {
  it("es una sola cola por proceso", () => {
    expect(chatQueryLimiter()).toBe(chatQueryLimiter());
  });
});
