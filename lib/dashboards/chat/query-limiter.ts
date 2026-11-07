/**
 * La cola de consultas del dashboard de Chat.
 *
 * Una carga pide muchos bloques a la vez. Sueltos, se pisan entre ellos en una
 * base chica y terminan cortados por el limite de 8 s de la base, aunque cada uno
 * solo tarde poco. Con la cola salen de a pocas, en el orden en que se pidieron:
 * los bloques de arriba primero.
 *
 * Lo que esperó demasiado se descarta sin correr: `Promise.race` (ver `result.ts`)
 * deja de esperar a una consulta, pero no la saca de la fila. Sin esto, una carga
 * que ya se dio por caida seguiria mandandole trabajo a la base.
 *
 * Puro, salvo el singleton del final.
 */

/** Consultas a la vez, por proceso. */
export const MAX_CONCURRENT_CHAT_QUERIES = 4;

/** Mas que esto en la fila y la consulta ya no corre. Menor que `BLOCK_TIMEOUT_MS`. */
export const QUEUE_MAX_WAIT_MS = 20_000;

export class QueueDeadlineError extends Error {
  constructor() {
    super("La consulta esperó demasiado en la cola");
    this.name = "QueueDeadlineError";
  }
}

export interface QueryLimiter {
  /** Corre la tarea cuando hay lugar. Rechaza con `QueueDeadlineError` si esperó demasiado. */
  run<T>(task: () => PromiseLike<T>, options?: { maxWaitMs?: number }): Promise<T>;
  readonly active: number;
  readonly queued: number;
}

interface Waiting {
  start: () => void;
  expire: () => void;
  deadlineAt: number;
}

export function createQueryLimiter(
  maxConcurrent: number = MAX_CONCURRENT_CHAT_QUERIES,
  now: () => number = Date.now,
): QueryLimiter {
  const queue: Waiting[] = [];
  let active = 0;

  function pump() {
    while (active < maxConcurrent && queue.length > 0) {
      const next = queue.shift() as Waiting;
      if (now() > next.deadlineAt) {
        next.expire();
        continue;
      }
      active += 1;
      next.start();
    }
  }

  return {
    run<T>(task: () => PromiseLike<T>, options?: { maxWaitMs?: number }): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          deadlineAt: now() + (options?.maxWaitMs ?? QUEUE_MAX_WAIT_MS),
          expire: () => reject(new QueueDeadlineError()),
          start: () => {
            // El lugar se libera ANTES de avisar: quien espera ya no lo esta ocupando.
            const release = () => {
              active -= 1;
              pump();
            };
            Promise.resolve()
              .then(task)
              .then(
                (value) => {
                  release();
                  resolve(value);
                },
                (reason) => {
                  release();
                  reject(reason);
                },
              );
          },
        });
        pump();
      });
    },
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
  };
}

// La pagina, la ruta y las acciones pueden cargar este modulo por separado (y en
// desarrollo se recarga solo): `globalThis` asegura una sola cola por proceso.
const SINGLETON = Symbol.for("ssa.chatDashboard.queryLimiter");

export function chatQueryLimiter(): QueryLimiter {
  const store = globalThis as unknown as Record<symbol, QueryLimiter | undefined>;
  const existing = store[SINGLETON];
  if (existing) return existing;
  const created = createQueryLimiter();
  store[SINGLETON] = created;
  return created;
}
