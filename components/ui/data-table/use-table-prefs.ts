"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { canonicalPrefs, emptyPrefs, normalizePrefs, parsePrefs, prefsEqual, type ColumnMeta, type TablePrefs } from "@/lib/ui/data-table/prefs";

/**
 * Las columnas de una tabla tal como las deja la persona, SIN guardar todavía en una vista.
 *
 * Lo que se ve es la vista activa (`base`) más los cambios hechos desde entonces. Esos cambios viven en `localStorage`
 * por tabla y por vista (`ssa:table:<tabla>:<vista>`): sobreviven a recargar, y si coinciden con la vista se borran solos.
 * Para guardarlos hay que apretar «Guardar» en el menú de vistas (los lleva a la base).
 *
 * `localStorage` puede no estar (ventana privada, datos bloqueados): siempre en `try/catch`, y los cambios viven en
 * memoria mientras dure la página. En el servidor (y en la primera pasada del navegador) el valor es «sin cambios», así
 * lo dibujado en el servidor y lo que hidrata es lo mismo.
 */

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

const storageKeyOf = (tableKey: string, viewKey: string) => `ssa:table:${tableKey}:${viewKey}`;

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  try {
    return safeStorage()?.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    const storage = safeStorage();
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Sin almacenamiento, el cambio vale hasta recargar.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

export interface TablePrefsState {
  /** Lo que se ve ahora: la vista más los cambios sin guardar. */
  prefs: TablePrefs;
  /** Lo guardado en la vista activa (o lo normal si no hay vista). */
  base: TablePrefs;
  /** Hay cambios de columnas sin guardar. */
  dirty: boolean;
  setPrefs: (next: TablePrefs) => void;
  /** Cambia las preferencias a partir de las últimas (seguro de llamar varias veces seguidas). */
  update: (change: (current: TablePrefs) => TablePrefs) => void;
  /** Vuelve a lo guardado en la vista. */
  discard: () => void;
  /** El catálogo con el que se resolvió todo (para los menús). */
  metas: readonly ColumnMeta[];
}

export function useTablePrefs(tableKey: string, viewKey: string, metas: readonly ColumnMeta[], baseRaw: TablePrefs | null): TablePrefsState {
  const key = storageKeyOf(tableKey, viewKey);
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );

  const base = useMemo(() => normalizePrefs(metas, baseRaw ?? emptyPrefs()), [metas, baseRaw]);
  const draft = useMemo(() => (raw === null ? null : normalizePrefs(metas, parsePrefs(raw))), [metas, raw]);
  const prefs = draft ?? base;
  const dirty = draft !== null && !prefsEqual(draft, base);

  const setPrefs = useCallback(
    (next: TablePrefs) => {
      const normalized = normalizePrefs(metas, next);
      writeRaw(key, prefsEqual(normalized, base) ? null : canonicalPrefs(normalized));
    },
    [key, metas, base],
  );

  const update = useCallback(
    (change: (current: TablePrefs) => TablePrefs) => {
      const latest = readRaw(key);
      const current = latest === null ? base : normalizePrefs(metas, parsePrefs(latest));
      setPrefs(change(current));
    },
    [key, metas, base, setPrefs],
  );

  const discard = useCallback(() => writeRaw(key, null), [key]);

  return { prefs, base, dirty, setPrefs, update, discard, metas };
}

/** Borra los cambios sin guardar de una vista (después de guardarla). */
export function clearTableDraft(tableKey: string, viewKey: string) {
  writeRaw(storageKeyOf(tableKey, viewKey), null);
}
