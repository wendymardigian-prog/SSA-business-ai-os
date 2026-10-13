"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parsePrefs, savePrefs, serializePrefs, storageKey, type ColumnLevel, type ColumnPrefs } from "@/lib/dashboards/ads-columns";

/**
 * Las columnas elegidas de la tabla «Meta vs CRM», por persona y por pestaña (F31).
 *
 * Se leen de `localStorage` con `useSyncExternalStore`: en el servidor (y en la primera pasada del navegador) el
 * valor es «nada guardado» —las columnas por defecto—, asi no hay diferencia entre lo que se dibuja en el servidor
 * y lo que hidrata. Si `localStorage` lanza o esta bloqueado (ventana privada), las elecciones viven en memoria
 * mientras dure la pagina: la pantalla anda igual, solo que no se recuerda para la proxima vez.
 */

const listeners = new Set<() => void>();
/** Lo elegido cuando no se pudo guardar en el navegador. */
const memory = new Map<ColumnLevel, string>();

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(level: ColumnLevel): string | null {
  try {
    return safeStorage()?.getItem(storageKey(level)) ?? memory.get(level) ?? null;
  } catch {
    return memory.get(level) ?? null;
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

export function useColumnPrefs(level: ColumnLevel): [ColumnPrefs, (next: ColumnPrefs) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(level),
    () => null,
  );
  const prefs = useMemo(() => parsePrefs(raw), [raw]);

  const save = useCallback(
    (next: ColumnPrefs) => {
      memory.set(level, serializePrefs(next));
      savePrefs(level, next, safeStorage());
      listeners.forEach((listener) => listener());
    },
    [level],
  );

  return [prefs, save];
}
