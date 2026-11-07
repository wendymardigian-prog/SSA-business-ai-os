/**
 * Deshacer y rehacer (F26): el historial EN MEMORIA de los últimos 100 cambios por sesión.
 *
 * - Un arrastre (mover, cambiar el tamaño, rotar) es UN solo paso: se abre una transacción al empezar (`begin`),
 *   los movimientos intermedios solo actualizan lo que se ve (`push` dentro de la transacción) y al soltar
 *   (`commit`) queda un único paso en el historial. Deshacer una vuelta la deja donde estaba antes de empezar.
 * - Escribir un texto o tocar las flechas hace muchos cambios seguidos del mismo tipo: con la misma `key` y dentro de
 *   una ventana corta se juntan en un solo paso (`coalesce`).
 * - Un cambio nuevo borra lo que se podía rehacer.
 *
 * Genérico (guarda lo que le des, normalmente el `DesignDoc`) e inmutable: cada función devuelve un historial nuevo.
 * Módulo puro.
 */

export const HISTORY_LIMIT = 100;
/** Dos cambios con la misma clave a menos de esto se juntan en un solo paso. */
export const COALESCE_WINDOW_MS = 1000;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Una transacción abierta (un arrastre): lo que había antes de empezar. */
  transaction: { base: T } | null;
  /** El último cambio juntable (para escribir de corrido). */
  last: { key: string; at: number } | null;
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], transaction: null, last: null };
}

function trim<T>(past: T[]): T[] {
  return past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past;
}

export interface PushOptions {
  /** Juntar con el cambio anterior si tiene la misma clave y fue hace poco. */
  coalesce?: string;
  now?: number;
}

/** Un cambio. Dentro de una transacción solo actualiza lo que se ve. Igual al presente = nada que hacer. */
export function push<T>(history: History<T>, next: T, options: PushOptions = {}): History<T> {
  if (Object.is(next, history.present)) return history;
  if (history.transaction) return { ...history, present: next };
  const now = options.now ?? Date.now();
  const key = options.coalesce;
  if (key && history.last && history.last.key === key && now - history.last.at <= COALESCE_WINDOW_MS && history.past.length > 0) {
    return { ...history, present: next, future: [], last: { key, at: now } };
  }
  return {
    ...history,
    past: trim([...history.past, history.present]),
    present: next,
    future: [],
    last: key ? { key, at: now } : null,
  };
}

/** Abre una transacción: todo lo que pase hasta `commit` es un solo paso. */
export function begin<T>(history: History<T>): History<T> {
  return history.transaction ? history : { ...history, transaction: { base: history.present }, last: null };
}

/** Cierra la transacción: si algo cambió, queda UN paso; si no, no queda ninguno. */
export function commit<T>(history: History<T>): History<T> {
  const tx = history.transaction;
  if (!tx) return history;
  if (Object.is(tx.base, history.present)) return { ...history, transaction: null };
  return { ...history, past: trim([...history.past, tx.base]), future: [], transaction: null, last: null };
}

/** Cancela la transacción: vuelve a lo de antes (por ejemplo, Esc en medio de un arrastre). */
export function cancel<T>(history: History<T>): History<T> {
  const tx = history.transaction;
  return tx ? { ...history, present: tx.base, transaction: null } : history;
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0 || (history.transaction !== null && !Object.is(history.transaction.base, history.present));
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  const settled = commit(history);
  if (settled.past.length === 0) return settled;
  const previous = settled.past[settled.past.length - 1];
  return { ...settled, past: settled.past.slice(0, -1), present: previous, future: [settled.present, ...settled.future], last: null };
}

export function redo<T>(history: History<T>): History<T> {
  const settled = commit(history);
  if (settled.future.length === 0) return settled;
  const [next, ...rest] = settled.future;
  return { ...settled, past: trim([...settled.past, settled.present]), present: next, future: rest, last: null };
}

/** Empieza de cero con otro documento (se recargó desde el servidor, se restauró una versión). */
export function reset<T>(present: T): History<T> {
  return createHistory(present);
}
