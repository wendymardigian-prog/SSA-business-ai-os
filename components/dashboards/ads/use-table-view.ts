"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ColumnId } from "@/lib/dashboards/ads-crm-columns";
import type { CrmLevel } from "@/lib/dashboards/ads-crm";
import { COLORS_STORAGE_KEY, parseColors, parsePinned, pinnedStorageKey, serializeColors, serializePinned, togglePinned } from "@/lib/dashboards/ads-table-view";

/**
 * Las columnas fijas (por pestaña) y el interruptor de los colores de la tabla «Meta vs CRM», por persona.
 *
 * Igual que `use-column-prefs.ts`: se leen de `localStorage` con `useSyncExternalStore` (en el servidor, nada guardado:
 * sin fijas y con colores), todo acceso va en `try/catch`, y si el navegador no deja guardar lo elegido vive en memoria
 * mientras dure la pagina.
 */

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

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

function writeRaw(key: string, value: string) {
  memory.set(key, value);
  try {
    safeStorage()?.setItem(key, value);
  } catch {
    // Bloqueado o lleno: queda en memoria.
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

function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
}

export interface TableView {
  pinned: ColumnId[];
  togglePin: (id: ColumnId) => void;
  colors: boolean;
  setColors: (on: boolean) => void;
}

export function useTableView(level: CrmLevel): TableView {
  const pinnedKey = pinnedStorageKey(level);
  const pinnedRaw = useStored(pinnedKey);
  const colorsRaw = useStored(COLORS_STORAGE_KEY);
  const pinned = useMemo(() => parsePinned(pinnedRaw), [pinnedRaw]);
  const colors = parseColors(colorsRaw);

  const togglePin = useCallback((id: ColumnId) => writeRaw(pinnedKey, serializePinned(togglePinned(parsePinned(readRaw(pinnedKey)), id))), [pinnedKey]);
  const setColors = useCallback((on: boolean) => writeRaw(COLORS_STORAGE_KEY, serializeColors(on)), []);

  return { pinned, togglePin, colors, setColors };
}
