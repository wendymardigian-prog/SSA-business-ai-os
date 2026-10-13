"use client";

import { useSyncExternalStore } from "react";

/**
 * ¿Pantalla de escritorio (768 px o mas, el `md` de Tailwind)? El arrastre del calendario solo existe ahi: en el celular
 * se abre la tarea o la agenda y se edita en su panel. En el servidor (y antes de hidratar) responde que no, asi lo que se
 * dibuja primero es lo mismo que sin arrastre.
 */
const QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
