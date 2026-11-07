"use client";

/**
 * Paso «Archivo» del modal Nuevo (F39–F41): subir el .html o .zip, ver lo detectado y corregirlo.
 *
 * Punto de montaje de la Ola 1: las props son el contrato (`lib/designer/contracts.ts`); el componente
 * real lo construye DS4 reemplazando ESTE archivo. Nadie más lo edita.
 */

import type { HtmlStepProps } from "@/lib/designer/contracts";

export function HtmlStep(_props: HtmlStepProps) {
  return null;
}
