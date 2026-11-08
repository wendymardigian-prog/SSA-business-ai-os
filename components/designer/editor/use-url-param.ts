"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "designer:url";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/**
 * Un parámetro de la URL como estado (`?tab=`, `?panel=`, `?config=`): las pestañas y los drawers del editor viven en la
 * URL. Se escribe con `history.pushState` / `replaceState`, sin pedirle la página al servidor otra vez; todos los
 * componentes que lo leen se enteran por un evento.
 */
export function useUrlParam(key: string): [string | null, (value: string | null, mode?: "push" | "replace") => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(key),
    () => null,
  );
  const set = useCallback(
    (next: string | null, mode: "push" | "replace" = "push") => {
      const url = new URL(window.location.href);
      if (next === null || next === "") url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}
