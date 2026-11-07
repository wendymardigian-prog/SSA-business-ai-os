/**
 * Tipos de las Server Actions de la IA del Diseñador. Viven acá y no en
 * `lib/actions/designer/ai.ts` porque un archivo `"use server"` solo puede
 * exportar funciones asincrónicas.
 *
 * Los de entrada extienden los del contrato (`lib/designer/contracts.ts`) con
 * campos OPCIONALES: quien llama con la firma del contrato sigue funcionando.
 */

import type { AiAttachment } from "@/lib/ai-threads/schema";
import type { ActionResult, AiMessageView, ContentAiContext, DesignTarget } from "../contracts";

export interface StartAiDesignInput extends DesignTarget {
  prompt: string;
  style: string | null;
  attachments: AiAttachment[];
  /** Desde una pieza de Contenido (DS8): el guion, el caption, el pilar, la oferta y la etapa. */
  contentContext?: ContentAiContext;
  /** Lo que eligió la persona al crear: una sola página o varias. Sin esto, decide la IA. */
  multiPage?: boolean;
}

/** Si la IA está lista para usarse en este negocio (se muestra arriba del panel). */
export interface AiStatus {
  connected: boolean;
  /** Lo que se le dice a la persona si no está conectada. */
  message: string | null;
}

export type LoadConversationData = { threadId: string | null; messages: AiMessageView[]; ai: AiStatus };

export type AnswerProposalResult = ActionResult<{ rev?: number }>;
