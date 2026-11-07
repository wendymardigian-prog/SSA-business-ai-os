"use server";

/**
 * Publicar, despublicar y exportar (DS5, F43–F47). Publicar pide `designer.publish`; exportar, `designer.edit`;
 * anular, `designer.generate`. Los links salen de `publicBaseUrl` (dominio del negocio).
 *
 * Contrato de la Ola 1: firmas definitivas; el cuerpo lo construye DS5.
 */

import { NOT_BUILT_YET, type ActionResult, type DesignTarget, type ExportKind, type ExportResult, type PublicOptions } from "@/lib/designer/contracts";

export async function publishDesign(_input: { designId: string } & PublicOptions): Promise<ActionResult<{ link: string }>> {
  return NOT_BUILT_YET(2);
}

export async function unpublishDesign(_input: { designId: string }): Promise<ActionResult> {
  return NOT_BUILT_YET(2);
}

export async function setPublicOptions(_input: { designId: string } & PublicOptions): Promise<ActionResult> {
  return NOT_BUILT_YET(2);
}

/** Exportar (F46): si el archivo está, el link; si no, se prepara y se consulta con `exportStatus`. */
export async function requestExport(_input: DesignTarget & { exportKind: ExportKind; page?: number }): Promise<ExportResult> {
  return NOT_BUILT_YET(2);
}

export async function exportStatus(_input: DesignTarget & { exportKind: ExportKind; stamp: string; page?: number }): Promise<ExportResult> {
  return NOT_BUILT_YET(2);
}

/** Anular una generación con verificación (F47): motivo obligatorio, nunca se borra. */
export async function voidDesign(_input: { designId: string; reason: string }): Promise<ActionResult> {
  return NOT_BUILT_YET(2);
}
