"use client";

/**
 * Botón «Usar en contenido» / «En contenido ▾» de la barra del editor (F63).
 *
 * Punto de montaje de la Ola 1: las props son el contrato (`lib/designer/contracts.ts`); el componente
 * real lo construye DS8 reemplazando ESTE archivo. Nadie más lo edita.
 */

import type { UseInContentProps } from "@/lib/designer/contracts";

export function UseInContent(_props: UseInContentProps) {
  return null;
}
