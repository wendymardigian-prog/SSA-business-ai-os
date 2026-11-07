"use server";

/**
 * Server Actions de la IA del Diseñador (DS3). La conversación vive en `ai_threads` / `ai_messages`
 * (canal `designer`, un hilo por diseño o plantilla). El trabajo pesado corre en el job `design_ai_generate`.
 *
 * Contrato de la Ola 1: firmas definitivas (`lib/designer/contracts.ts`); el cuerpo lo construye DS3.
 */

import { NOT_BUILT_YET, type ActionResult, type AiMessageView, type DesignTarget, type SendAiMessageInput } from "@/lib/designer/contracts";
import type { AiAttachment } from "@/lib/ai-threads/schema";

/** La primera versión "Con IA" (F33): guarda el pedido y encola el job. */
export async function startAiDesign(_input: DesignTarget & { prompt: string; style: string | null; attachments: AiAttachment[] }): Promise<ActionResult<{ threadId: string; messageId: string }>> {
  return NOT_BUILT_YET(2);
}

export async function sendAiMessage(_input: SendAiMessageInput): Promise<ActionResult<{ threadId: string; messageId: string }>> {
  return NOT_BUILT_YET(2);
}

export async function loadConversation(_input: DesignTarget): Promise<ActionResult<{ threadId: string | null; messages: AiMessageView[] }>> {
  return NOT_BUILT_YET(2);
}

/** "Que la IA me proponga dónde van los textos y las variables" (F30). */
export async function proposeTemplateTexts(_input: { templateId: string }): Promise<ActionResult<{ messageId: string }>> {
  return NOT_BUILT_YET(2);
}

/** "Hacerlo / No" de una propuesta (F30 y la verificación de F47). */
export async function answerProposal(_input: DesignTarget & { messageId: string; accept: boolean }): Promise<ActionResult<{ rev?: number }>> {
  return NOT_BUILT_YET(2);
}

/** Rehacer con otro estilo (F35): mismos textos, otra paleta, tipografía y composición. */
export async function changeStyle(_input: DesignTarget & { style: string }): Promise<ActionResult<{ messageId: string }>> {
  return NOT_BUILT_YET(2);
}
