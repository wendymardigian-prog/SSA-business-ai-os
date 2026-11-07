"use server";

/**
 * Server Actions del editor (DS2): crear, guardar con `rev`, renombrar, duplicar, archivar, borrar,
 * versiones, restaurar, subir imágenes y la configuración de una plantilla.
 *
 * Contrato de la Ola 1: firmas definitivas (`lib/designer/contracts.ts`); el cuerpo lo construye DS2.
 * Cada acción valida su permiso adentro (`getPermissionAction`) y escribe con el cliente de servicio.
 */

import { NOT_BUILT_YET, type ActionResult, type CreateDesignInput, type CreateDesignResult, type DesignTarget, type SaveDocResult, type TemplateSettingsInput, type VersionSummary } from "@/lib/designer/contracts";

export async function createDesign(_input: CreateDesignInput): Promise<CreateDesignResult> {
  return NOT_BUILT_YET(2);
}

export async function saveDesignDoc(_input: DesignTarget & { doc: unknown; rev: number }): Promise<SaveDocResult> {
  return NOT_BUILT_YET(2);
}

export async function renameDesign(_input: DesignTarget & { name: string }): Promise<ActionResult> {
  return NOT_BUILT_YET(2);
}

export async function duplicateDesign(_input: DesignTarget): Promise<ActionResult<{ id: string; href: string }>> {
  return NOT_BUILT_YET(2);
}

/** Archivar: un diseño publicado pide confirmación (`needsConfirm`) y se despublica antes. */
export async function archiveDesign(_input: DesignTarget & { confirmUnpublish?: boolean }): Promise<ActionResult<{ needsConfirm?: boolean }>> {
  return NOT_BUILT_YET(2);
}

/** Borrar definitivamente: solo borradores sin uso y con `designer.manage`. */
export async function deleteDesign(_input: DesignTarget): Promise<ActionResult> {
  return NOT_BUILT_YET(2);
}

export async function listVersions(_input: DesignTarget): Promise<ActionResult<VersionSummary[]>> {
  return NOT_BUILT_YET(2);
}

/** Restaurar crea una versión nueva (nunca borra). */
export async function restoreVersion(_input: DesignTarget & { versionId: string }): Promise<ActionResult<{ rev: number }>> {
  return NOT_BUILT_YET(2);
}

/** Sube una imagen validada por sus bytes a `design-assets`. Devuelve la ruta y un link firmado para verla. */
export async function uploadDesignImageAction(_form: FormData): Promise<ActionResult<{ path: string; url: string; name: string; mime: string }>> {
  return NOT_BUILT_YET(2);
}

/** Configuración de una plantilla (F28): formato, verificación y tipo, formato de fecha, descarga y variables propias. */
export async function updateTemplateSettings(_input: TemplateSettingsInput): Promise<ActionResult<{ notice: string | null }>> {
  return NOT_BUILT_YET(2);
}
