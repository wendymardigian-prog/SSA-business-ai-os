"use server";

/**
 * Ajustes del Diseñador IA (DS3, F11 y F37): estilos propios y fuentes. Piden `designer.manage`.
 *
 * Contrato de la Ola 1: firmas definitivas; el cuerpo lo construye DS3.
 */

import { NOT_BUILT_YET, type ActionResult } from "@/lib/designer/contracts";
import type { DesignStyle } from "@/lib/designer/styles";

/** "+ Crear desde mis piezas": la IA extrae un estilo de 3 a 5 imágenes (o diseños existentes). */
export async function extractStyle(_form: FormData): Promise<ActionResult<{ style: DesignStyle }>> {
  return NOT_BUILT_YET(2);
}

export async function saveStyle(_input: { style: DesignStyle }): Promise<ActionResult> {
  return NOT_BUILT_YET(2);
}

export async function archiveStyle(_input: { key: string }): Promise<ActionResult> {
  return NOT_BUILT_YET(2);
}

/** "Otra fuente de Google": la valida pidiéndola a Google desde el servidor (200 = existe). */
export async function addGoogleFont(_input: { family: string }): Promise<ActionResult<{ family: string }>> {
  return NOT_BUILT_YET(2);
}

/** "Subir mi fuente": .woff2, .woff, .ttf u .otf de hasta 2 MB, validada por bytes. */
export async function uploadFont(_form: FormData): Promise<ActionResult<{ family: string; weight: number }>> {
  return NOT_BUILT_YET(2);
}

export async function removeFont(_input: { family: string; path?: string }): Promise<ActionResult> {
  return NOT_BUILT_YET(2);
}
