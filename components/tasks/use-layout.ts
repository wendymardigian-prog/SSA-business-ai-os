"use client";

import { useSyncExternalStore } from "react";
import { selectLayout, type TasksLayout } from "@/lib/tasks/layout";

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * `table` desde 768 px, `list` (tarjetas) por debajo. En el servidor no se conoce el ancho: devuelve `null` y la
 * pantalla muestra un esqueleto, asi no aparece la tabla un instante en el celular antes de pasar a tarjetas.
 */
export function useTasksLayout(): TasksLayout | null {
  return useSyncExternalStore(
    subscribe,
    () => selectLayout(window.innerWidth),
    () => null,
  );
}
