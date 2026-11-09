"use client";

import { useSyncExternalStore } from "react";
import type { NavFavorites } from "@/lib/nav/items";

/**
 * Las favoritas del menu, compartidas entre el menu lateral y el panel del telefono (los dos montan
 * `NavLinks`). El panel se desmonta al cerrarse: con un estado propio, al reabrirlo volveria a lo que
 * trajo el servidor y perderia el pin recien marcado. Mientras nadie marco nada, vale lo del servidor.
 */
let current: NavFavorites | null = null;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function setSharedNavFavorites(next: NavFavorites) {
  current = next;
  for (const listener of listeners) listener();
}

export function useNavFavorites(initial: NavFavorites): NavFavorites {
  return useSyncExternalStore(
    subscribe,
    () => current ?? initial,
    () => initial,
  );
}
