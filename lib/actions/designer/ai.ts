"use server";

/**
 * Server Actions de la IA del Diseñador (DS3). La conversación vive en `ai_threads` / `ai_messages`
 * (canal `designer`, un hilo por diseño o plantilla). El trabajo pesado corre en el job `design_ai_generate`
 * (`lib/designer/jobs/ai-generate.ts`); estas acciones dejan el pedido en el hilo y lo encolan.
 *
 * Cada acción valida su permiso adentro (`getPermissionAction`), saca el negocio y la persona de la SESIÓN
 * (nunca del navegador) y escribe con el cliente de servicio. Nunca lanzan hacia la pantalla: devuelven
 * `{ ok: false, error }`. La lógica está en `lib/designer/ai/requests.ts` (con sus tests).
 *
 * Firmas del contrato de la Ola 1 (`lib/designer/contracts.ts`); los campos de más de la entrada
 * (`contentContext`, `multiPage`) y de la salida (`ai`) son opcionales o aditivos.
 */

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import type { AiAttachment } from "@/lib/ai-threads/schema";
import type { ActionResult, DesignTarget, SendAiMessageInput } from "@/lib/designer/contracts";
import type { AnswerProposalResult, LoadConversationData, StartAiDesignInput } from "@/lib/designer/ai/action-types";
import { answerProposalRequest, loadConversationView, submitRequest, submitStyleChange, submitTextProposal } from "@/lib/designer/ai/requests";

const NO_PERMISSION = "No tenés permiso para hacer esto.";
const GENERIC = "No pude hacerlo ahora. Probá de nuevo.";

type Service = Awaited<ReturnType<typeof createServiceClient>>;
type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

/** Valida el permiso y arma el cliente de servicio; un imprevisto no lanza hacia la pantalla. */
async function guarded<T>(permission: "designer.edit" | "designer.view", run: (ctx: Ctx, service: Service) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const ctx = await getPermissionAction(permission);
    if (!ctx) return { ok: false, error: NO_PERMISSION };
    return await run(ctx, await createServiceClient());
  } catch (error) {
    console.error("[designer-ai] la acción falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: GENERIC };
  }
}

/** La primera versión «Con IA» (F33): guarda el pedido y encola el job. */
export async function startAiDesign(input: StartAiDesignInput): Promise<ActionResult<{ threadId: string; messageId: string }>> {
  return guarded("designer.edit", (ctx, service) =>
    submitRequest(service, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      kind: input.kind,
      id: input.id,
      mode: "first",
      text: input.prompt,
      attachments: input.attachments as AiAttachment[],
      styleKey: input.style,
      multiPage: input.multiPage,
      contentContext: input.contentContext,
    }),
  );
}

/** Un pedido de cambio (F31, F34): de todo el diseño o solo de una página. */
export async function sendAiMessage(input: SendAiMessageInput): Promise<ActionResult<{ threadId: string; messageId: string }>> {
  return guarded("designer.edit", (ctx, service) =>
    submitRequest(service, {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      kind: input.kind,
      id: input.id,
      mode: "change",
      text: input.text,
      page: input.page,
      attachments: input.attachments,
      baseRev: input.baseRev,
    }),
  );
}

/** La conversación del diseño o la plantilla (la puede leer quien puede ver el módulo). */
export async function loadConversation(input: DesignTarget): Promise<ActionResult<LoadConversationData>> {
  return guarded("designer.view", (ctx, service) => loadConversationView(service, { workspaceId: ctx.workspace.id, kind: input.kind, id: input.id }));
}

/** «Que la IA me proponga dónde van los textos y las variables» (F30). */
export async function proposeTemplateTexts(input: { templateId: string }): Promise<ActionResult<{ messageId: string }>> {
  return guarded("designer.edit", (ctx, service) => submitTextProposal(service, { workspaceId: ctx.workspace.id, userId: ctx.user.id, templateId: input.templateId }));
}

/** «Hacerlo / No» de una propuesta (F30 y la verificación de F47). */
export async function answerProposal(input: DesignTarget & { messageId: string; accept: boolean }): Promise<AnswerProposalResult> {
  return guarded("designer.edit", (ctx, service) => answerProposalRequest(service, { workspaceId: ctx.workspace.id, userId: ctx.user.id, kind: input.kind, id: input.id, messageId: input.messageId, accept: input.accept }));
}

/** Rehacer con otro estilo (F35): mismos textos, otra paleta, tipografía y composición. */
export async function changeStyle(input: DesignTarget & { style: string }): Promise<ActionResult<{ messageId: string }>> {
  return guarded("designer.edit", (ctx, service) => submitStyleChange(service, { workspaceId: ctx.workspace.id, userId: ctx.user.id, kind: input.kind, id: input.id, style: input.style }));
}
