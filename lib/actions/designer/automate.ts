"use server";

/**
 * "Automatizar" desde una plantilla (DS7, F60): crea un borrador de automatización con "Formulario enviado",
 * el nodo "Generar desde plantilla" y un "Enviar email". Pide `flows.edit` y `designer.view`.
 *
 * Contrato de la Ola 1: firma definitiva; el cuerpo lo construye la sesión principal en la Ola 4.
 */

import { NOT_BUILT_YET, type ActionResult } from "@/lib/designer/contracts";

export async function createAutomationFromTemplate(_input: { templateId: string }): Promise<ActionResult<{ flowId: string; href: string }>> {
  return NOT_BUILT_YET(4);
}

/** Las automatizaciones que ya usan la plantilla (para listarlas con su link). */
export async function automationsUsingTemplate(_input: { templateId: string }): Promise<ActionResult<{ id: string; name: string; href: string; status: string }[]>> {
  return NOT_BUILT_YET(4);
}
