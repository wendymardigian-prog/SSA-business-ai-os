"use server";

/**
 * Cargar un archivo HTML (DS4, F39–F42): primero se lee y se limpia (`inspectHtmlUpload`), la persona
 * confirma o corrige lo detectado, y recién ahí se crea el diseño (`importHtml`).
 *
 * Contrato de la Ola 1: firmas definitivas; el cuerpo lo construye DS4.
 */

import { NOT_BUILT_YET, type ActionResult, type DesignKind, type HtmlImportKind, type HtmlInspection } from "@/lib/designer/contracts";

/** `.html` (≤ 5 MB) o `.zip` (≤ 50 MB): descomprime, limpia, sube los recursos y detecta el formato. */
export async function inspectHtmlUpload(_form: FormData): Promise<ActionResult<HtmlInspection>> {
  return NOT_BUILT_YET(2);
}

export async function importHtml(_input: { uploadId: string; kind: DesignKind; as: HtmlImportKind; name?: string }): Promise<ActionResult<{ id: string; kind: DesignKind; href: string }>> {
  return NOT_BUILT_YET(2);
}
