"use server";

/**
 * Generar desde plantilla (DS6, F50–F56): para uno, para varios, reintentar, volver a generar y mandar el email.
 * Piden `designer.generate`.
 *
 * Contrato de la Ola 1: firmas definitivas; el cuerpo lo construye DS6.
 */

import { NOT_BUILT_YET, type ActionResult, type GenerateManyInput, type GenerateOneInput, type GenerationPreview } from "@/lib/designer/contracts";

export async function previewGeneration(_input: { templateId: string; contactId: string | null; overrides: Record<string, string> }): Promise<ActionResult<GenerationPreview>> {
  return NOT_BUILT_YET(3);
}

export async function generateOne(_input: GenerateOneInput): Promise<ActionResult<{ designId: string; code: string; link: string }>> {
  return NOT_BUILT_YET(3);
}

export async function countGenerationAudience(_input: Omit<GenerateManyInput, "publish" | "email">): Promise<ActionResult<{ total: number; existing: number; willGenerate: number }>> {
  return NOT_BUILT_YET(3);
}

export async function generateMany(_input: GenerateManyInput): Promise<ActionResult<{ queued: number }>> {
  return NOT_BUILT_YET(3);
}

/** Reintentar (F54): un render fallido se vuelve a renderizar; una falla de datos pide el dato. */
export async function retryGeneration(_input: { designId: string; values?: Record<string, string> }): Promise<ActionResult<{ needs?: { key: string; label: string }[] }>> {
  return NOT_BUILT_YET(3);
}

/** Reintentar todas las fallidas de una plantilla (las de render; las de datos piden el dato una por una). */
export async function retryFailedGenerations(_input: { templateId: string }): Promise<ActionResult<{ retried: number; needData: number }>> {
  return NOT_BUILT_YET(3);
}

/** Volver a generar (F47): anula la anterior ("Reemplazado por <código>") y genera una nueva con los datos de hoy. */
export async function regenerate(_input: { designId: string }): Promise<ActionResult<{ designId: string; code: string }>> {
  return NOT_BUILT_YET(3);
}

/** "Mandar el email ahora" (F54): el reintento nunca vuelve a correr la automatización. */
export async function sendGenerationEmail(_input: { designId: string; subject?: string; body?: string }): Promise<ActionResult> {
  return NOT_BUILT_YET(3);
}
