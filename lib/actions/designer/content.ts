"use server";

/**
 * Vínculo con Contenido (DS8, F61–F66). Piden `designer.edit` y `content.create`.
 *
 * Contrato de la Ola 1: firmas definitivas; el cuerpo lo construye DS8.
 */

import { NOT_BUILT_YET, type ActionResult, type UseInContentInput } from "@/lib/designer/contracts";

export async function useInContent(_input: UseInContentInput): Promise<ActionResult<{ postId: string; href: string }>> {
  return NOT_BUILT_YET(3);
}

/** "✦ Diseñar con el Diseñador IA" desde la pieza (F62): crea el diseño vinculado y lo abre. */
export async function designFromPiece(_input: { postId: string; platform: string }): Promise<ActionResult<{ designId: string; href: string }>> {
  return NOT_BUILT_YET(3);
}

/** "Enviar los cambios a la pieza" / "Actualizar los archivos" (F64). */
export async function syncToPiece(_input: { designId: string; force?: boolean }): Promise<ActionResult<{ queued: boolean }>> {
  return NOT_BUILT_YET(3);
}

/** Desvincular: los archivos que ya estaban quedan en la pieza (F66). */
export async function unlinkFromPiece(_input: { designId: string }): Promise<ActionResult> {
  return NOT_BUILT_YET(3);
}
