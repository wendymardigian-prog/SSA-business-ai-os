/**
 * El "se saltea con el motivo" de los pasos de grupos de WhatsApp (00344): anota el motivo en la ejecucion
 * (`noteStep`), en `analytics_events` (`node_skipped`) y avisa al lienzo. Nunca lanza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlowExecutionContext } from "../types";

export async function skipGroupStep(
  supabase: SupabaseClient,
  context: FlowExecutionContext,
  node: { id: string },
  step: { type: string; label: string },
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  console.warn(`[flow-engine] el nodo ${node.id} (${step.type}) se saltea: ${reason}`);
  context.noteStep?.({ status: "skipped", reason });
  try {
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "node_skipped",
      metadata: { nodeId: node.id, nodeType: step.type, reason, ...extra },
    });
  } catch (err) {
    console.error(`[flow-engine] no pude anotar el salto de ${step.type}:`, err instanceof Error ? err.message : String(err));
  }
  try {
    context.onStepSkipped?.({ nodeId: node.id, nodeType: step.type, label: step.label });
  } catch {
    // Un aviso que falla no frena el flujo.
  }
}
