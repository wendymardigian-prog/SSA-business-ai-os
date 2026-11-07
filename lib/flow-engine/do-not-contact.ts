/**
 * "No contactar" en los pasos que mandan por un canal (Enviar mensaje, Enviar recurso, Respuesta con IA).
 *
 * Una sola regla, la misma que ya tenia "Enviar email": un contacto marcado "no contactar" no recibe nada de un
 * flujo, SALVO que el flujo haya arrancado por un disparador de la agenda (la confirmacion o el recordatorio de
 * una reunion que la persona pidio no es una comunicacion comercial). Cambio aprobado por la dueña (lote 3 de
 * seguridad): antes WhatsApp e Instagram mandaban igual.
 *
 * El paso se saltea con el motivo (historial de ejecuciones y `node_skipped`) y el flujo SIGUE: un paso que no
 * manda no corta lo que viene despues (poner una etiqueta, avisar al equipo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { BOOKING_TRIGGER_SCOPE } from "@/lib/scheduling/automation/context";
import type { FlowExecutionContext } from "./types";

type Db = SupabaseClient<Database>;

export const DO_NOT_CONTACT_SKIP_REASON = "El contacto está marcado «no contactar»: no se mandó.";
export const DO_NOT_CONTACT_UNKNOWN_REASON = "No pude comprobar si el contacto está marcado «no contactar»: no se mandó.";

/** El flujo arranco por un disparador de la agenda (confirmacion, recordatorio, seguimiento de una reunion). */
export function isBookingTriggered(context: Pick<FlowExecutionContext, "variables">): boolean {
  return context.variables?.trigger_scope === BOOKING_TRIGGER_SCOPE;
}

/**
 * Por que este paso no tiene que mandar, o null si puede. Sin contacto no hay "no contactar" que mirar. Si la base
 * no contesta, no se manda (ante la duda, no se le escribe a alguien que pidio que no).
 */
export async function doNotContactSkipReason(
  supabase: Db,
  context: Pick<FlowExecutionContext, "contactId" | "variables">,
): Promise<string | null> {
  if (!context.contactId || isBookingTriggered(context)) return null;
  const { data, error } = await supabase.from("contacts").select("do_not_contact").eq("id", context.contactId).maybeSingle();
  if (error) return DO_NOT_CONTACT_UNKNOWN_REASON;
  return (data as { do_not_contact?: boolean } | null)?.do_not_contact === true ? DO_NOT_CONTACT_SKIP_REASON : null;
}

/** Saltea el paso con el motivo: historial de ejecuciones, `node_skipped` y el aviso del lienzo. Nunca lanza. */
export async function skipForDoNotContact(
  supabase: Db,
  context: FlowExecutionContext,
  step: { nodeId: string; nodeType: string; label: string; reason: string },
): Promise<void> {
  console.warn(`[flow-engine] el nodo ${step.nodeId} (${step.nodeType}) se saltea: ${step.reason}`);
  context.noteStep?.({ status: "skipped", reason: step.reason });
  try {
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "node_skipped",
      metadata: { nodeId: step.nodeId, nodeType: step.nodeType, reason: "do_not_contact" },
    });
    context.onStepSkipped?.({ nodeId: step.nodeId, nodeType: step.nodeType, label: step.label });
  } catch {
    // Anotar el salto nunca frena el flujo.
  }
}
