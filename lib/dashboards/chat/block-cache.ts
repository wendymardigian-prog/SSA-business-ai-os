/**
 * La cache en memoria de los bloques del dashboard de Chat.
 *
 * Volver a la pantalla o repetir un filtro no tiene por que repetir las consultas,
 * y dos pestañas pidiendo lo mismo comparten la que ya esta en curso.
 *
 * - **La clave lleva a la persona**: el resultado depende de lo que su RLS le deja
 *   ver, asi que dos personas nunca comparten una entrada. Por eso no se usa
 *   `unstable_cache`, que no puede leer la sesion adentro.
 * - **Solo se guarda lo que anduvo**: un error tiene que poder reintentarse enseguida.
 * - **`minStoredAt`** hace vencer lo anterior a una marca (ver `generation.ts`): asi
 *   "Actualizar" y las correcciones invalidan tambien en las otras replicas, donde
 *   esta memoria es otra.
 *
 * Si a alguien le reducen el alcance, puede seguir viendo totales viejos hasta que
 * venza la entrada. Son solo agregados y dura `CHAT_BLOCK_TTL_MS`.
 *
 * Puro, salvo el singleton del final.
 */

import type { BlockResult } from "./types";

export const CHAT_BLOCK_TTL_MS = 90_000;
export const CHAT_BLOCK_MAX_ENTRIES = 200;

interface Stored {
  result: BlockResult<unknown>;
  storedAt: number;
}

interface InFlight {
  promise: Promise<BlockResult<unknown>>;
  startedAt: number;
}

export interface BlockCacheReadOptions {
  /** Lo guardado (o empezado) antes de este instante cuenta como vencido. */
  minStoredAt?: number;
  /** No usar lo guardado. Sí se suma a lo que ya esté en curso: "Reintentar" no duplica consultas. */
  skipStored?: boolean;
}

export interface BlockCache {
  get<T>(key: string, load: () => Promise<BlockResult<T>>, options?: BlockCacheReadOptions): Promise<BlockResult<T>>;
  readonly size: number;
  clear(): void;
}

export function createBlockCache(
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): BlockCache {
  const ttlMs = options.ttlMs ?? CHAT_BLOCK_TTL_MS;
  const maxEntries = options.maxEntries ?? CHAT_BLOCK_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  const stored = new Map<string, Stored>();
  const inFlight = new Map<string, InFlight>();

  function remember(key: string, result: BlockResult<unknown>, storedAt: number) {
    stored.delete(key);
    stored.set(key, { result, storedAt });
    while (stored.size > maxEntries) {
      // Map conserva el orden de insercion: la primera es la que hace mas que no se usa.
      stored.delete(stored.keys().next().value as string);
    }
  }

  return {
    get<T>(key: string, load: () => Promise<BlockResult<T>>, read: BlockCacheReadOptions = {}): Promise<BlockResult<T>> {
      const minStoredAt = read.minStoredAt ?? 0;
      const at = now();

      const entry = stored.get(key);
      if (entry) {
        const alive = at - entry.storedAt < ttlMs && entry.storedAt >= minStoredAt;
        if (alive && !read.skipStored) {
          stored.delete(key);
          stored.set(key, entry);
          return Promise.resolve(entry.result as BlockResult<T>);
        }
        if (!alive) stored.delete(key);
      }

      const running = inFlight.get(key);
      if (running && running.startedAt >= minStoredAt) return running.promise as Promise<BlockResult<T>>;

      const promise: Promise<BlockResult<unknown>> = load()
        .then((result) => {
          if (result.ok) remember(key, result, at);
          return result;
        })
        .finally(() => {
          if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
        });
      inFlight.set(key, { promise, startedAt: at });
      return promise as Promise<BlockResult<T>>;
    },
    get size() {
      return stored.size;
    },
    clear() {
      stored.clear();
      inFlight.clear();
    },
  };
}

/**
 * La clave de un bloque.
 *
 * Usa el rango resuelto y nunca el periodo anterior: con un rango abierto, el
 * anterior cambia a cada milisegundo y la cache no acertaria nunca. Tampoco el
 * atajo solo: "hoy" no es lo mismo despues de medianoche.
 */
export function chatBlockCacheKey(parts: {
  userId: string;
  workspaceId: string;
  block: string;
  channel: string | null;
  author: string | null;
  rangeFrom: string | null;
  rangeTo: string | null;
  timezone: string;
}): string {
  return JSON.stringify([
    parts.userId,
    parts.workspaceId,
    parts.block,
    parts.channel,
    parts.author,
    parts.rangeFrom,
    parts.rangeTo,
    parts.timezone,
  ]);
}

const SINGLETON = Symbol.for("ssa.chatDashboard.blockCache");

export function chatBlockCache(): BlockCache {
  const store = globalThis as unknown as Record<symbol, BlockCache | undefined>;
  const existing = store[SINGLETON];
  if (existing) return existing;
  const created = createBlockCache();
  store[SINGLETON] = created;
  return created;
}
