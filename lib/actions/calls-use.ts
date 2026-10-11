"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { knowledgeEligibility } from "@/lib/calls/knowledge-run";
import { enqueueCallJob } from "@/lib/calls/queue";
import { summaryEligibility } from "@/lib/calls/summary";

/**
 * Lo que se hace con una llamada ya procesada (F29, F30, F31): resumirla y
 * mandarla a la base de conocimiento. Los dos botones encolan un job; lo que
 * corre es el handler (`call_summary`, `call_index_knowledge`).
 *
 * Se lee con el cliente de QUIEN PIDE (la RLS decide que llamadas ve) y se
 * encola con el de servicio.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CallUseResult = { ok: true; message: string } | { ok: false; error: string };

function refresh(callId: string) {
  revalidatePath(`/dashboard/llamadas/${callId}`);
  revalidatePath("/dashboard/llamadas");
}

/** "Resumir" (y "Reintentar memoria": la misma corrida vuelve a integrar la memoria con la actual). */
export async function summarizeCall(input: { callId: string }): Promise<CallUseResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar llamadas" };
  if (!UUID.test(input.callId)) return { ok: false, error: "Los datos no son válidos" };

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, call_type, transcript, summary_status")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: "No encontré esa llamada" };

  const eligible = summaryEligibility(call);
  if (!eligible.ok) return { ok: false, error: eligible.reason };

  const service = await createServiceClient();
  const { queued } = await enqueueCallJob(service, "call_summary", call.id, new Date(), { manual: true, requestedBy: ctx.user.id });
  if (!queued) return { ok: false, error: "Ya hay un resumen en la cola para esta llamada" };
  await service.from("calls").update({ summary_status: "pending" }).eq("id", call.id);
  refresh(call.id);
  return { ok: true, message: "Se está resumiendo" };
}

/** "Mandar a Conocimiento": con `calls.edit` Y `knowledge.edit`. Nunca una reunión de equipo. */
export async function sendCallToKnowledge(input: { callId: string }): Promise<CallUseResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar llamadas" };
  if (!ctx.can("knowledge.edit")) return { ok: false, error: "No tenés permiso para editar la base de conocimiento" };
  if (!UUID.test(input.callId)) return { ok: false, error: "Los datos no son válidos" };

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, call_type, transcript")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: "No encontré esa llamada" };

  const eligible = knowledgeEligibility(call);
  if (!eligible.ok) return { ok: false, error: eligible.reason };

  const service = await createServiceClient();
  const { queued } = await enqueueCallJob(service, "call_index_knowledge", call.id, new Date(), { requestedBy: ctx.user.id });
  if (!queued) return { ok: false, error: "Ya se está mandando a Conocimiento" };
  refresh(call.id);
  return { ok: true, message: "Se está mandando a Conocimiento" };
}
