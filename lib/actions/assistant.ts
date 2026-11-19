"use server";

import { archiveAssistantThreads } from "@/lib/ai-threads/store";
import { assistantActor, assistantPanelMessages, type AssistantActor, type PanelMessage } from "@/lib/assistant/actor";
import { assistantUnavailable, continueAssistantTurn, loadAssistantAgent, runAssistantTurn, type AssistantTurnResult } from "@/lib/assistant/turn";

/**
 * El asistente del equipo: botón flotante y panel acoplado y pantalla completa. El
 * negocio y la persona salen de la sesión, nunca del navegador. Sin «Usar el asistente» no se lee ni se escribe nada (se
 * comprueba aquí y en el motor). Aprobar o rechazar lo propuesto usa las mismas acciones que la bandeja de aprobación
 * (`lib/actions/ai-proposals`); después, `continueAssistantMessage` reanuda desde el paso donde estaba.
 *
 * Los tipos `PanelMessage` y `PanelStep` se importan de `@/lib/assistant/actor`, no de aquí: en un archivo
 * "use server" un re-export (`export type { … }`) rompe la app en tiempo de ejecución (lib/vault-boundary.test.ts).
 */

export interface AssistantPanelData {
  available: boolean;
  offReason: string | null;
  messages: PanelMessage[];
}

export async function loadAssistantPanel(): Promise<AssistantPanelData> {
  const a = await assistantActor();
  if (!a) return { available: false, offReason: "Tu sesión terminó. Volvé a entrar.", messages: [] };
  const agent = await loadAssistantAgent(a.service, a.ctx.workspace.id);
  const offReason = assistantUnavailable(a.ctx.can, agent);
  if (!a.ctx.can("assistant.use")) return { available: false, offReason, messages: [] };
  try {
    return { available: offReason === null, offReason, messages: await assistantPanelMessages(a) };
  } catch (err) {
    console.error("[assistant] no pude leer el panel:", err instanceof Error ? err.message : String(err));
    return { available: offReason === null, offReason: offReason ?? null, messages: [] };
  }
}

export type SendAssistantResult = { ok: true; messages: PanelMessage[] } | { ok: false; message: string; messages?: PanelMessage[] };

async function afterTurn(a: AssistantActor, r: AssistantTurnResult): Promise<SendAssistantResult> {
  if (!r.ok) {
    // Si llegó a guardar algo (un fallo del modelo), se devuelve la conversación para que se vea.
    const messages = r.threadId ? await assistantPanelMessages(a).catch(() => undefined) : undefined;
    return { ok: false, message: r.message, messages };
  }
  return { ok: true, messages: await assistantPanelMessages(a) };
}

export async function sendAssistantMessage(text: string): Promise<SendAssistantResult> {
  const a = await assistantActor();
  if (!a) return { ok: false, message: "Tu sesión terminó. Volvé a entrar." };
  return afterTurn(a, await runAssistantTurn(a.tool, text));
}

/** Sigue una respuesta desde el paso donde estaba (lo propuesto ya se decidió, o se cortó a mitad). */
export async function continueAssistantMessage(messageId: string): Promise<SendAssistantResult> {
  const a = await assistantActor();
  if (!a) return { ok: false, message: "Tu sesión terminó. Volvé a entrar." };
  return afterTurn(a, await continueAssistantTurn(a.tool, messageId));
}

export async function newAssistantConversation(): Promise<{ ok: boolean; message?: string }> {
  const a = await assistantActor();
  if (!a) return { ok: false, message: "Tu sesión terminó. Volvé a entrar." };
  if (!a.ctx.can("assistant.use")) return { ok: false, message: "Tu rol no tiene el permiso «Usar el asistente»." };
  try {
    await archiveAssistantThreads(a.service, { workspaceId: a.ctx.workspace.id, userId: a.ctx.user.id });
    return { ok: true };
  } catch (err) {
    console.error("[assistant] no pude archivar:", err instanceof Error ? err.message : String(err));
    return { ok: false, message: "No pude empezar una conversación nueva. Probá otra vez." };
  }
}
