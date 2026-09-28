"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import { flowGraph } from "@/lib/scheduling/data/event-flows";
import { flowToLinear, linearToFlow, type LinearFlow } from "@/lib/scheduling/automation/linear-flow";
import { backfillRelativeJobs } from "@/lib/scheduling/automation/relative";
import { isRelativeTrigger } from "@/lib/scheduling/automation/triggers";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { sendTransactionalEmail } from "@/lib/email/send";
import { bodyToHtml } from "@/lib/flow-engine/nodes/send-email";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { emptyBookingVariables } from "@/lib/scheduling/automation/variables";

/**
 * Los flujos de un evento (F48, F49, F57).
 *
 * Prender un flujo es publicar el flow y activar su trigger. Si el trigger es
 * relativo ("24 h antes"), además se replanifican los avisos de las reuniones
 * futuras que ya existen: quien lo prende espera que valga para lo que ya
 * tiene agendado, no solo para lo que se agende desde ahora.
 */

const PATH = "/dashboard/agenda/configuracion/eventos";

export type FlowActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

type OwnedFlow =
  | { error: string; ctx?: undefined; found?: undefined }
  | { error?: undefined; ctx: PermissionContext; found: NonNullable<Awaited<ReturnType<typeof flowGraph>>> };

async function ownedFlow(flowId: string): Promise<OwnedFlow> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { error: "No tenés permiso para tocar los flujos." };
  const found = await flowGraph(ctx.supabase, flowId);
  if (!found || found.flow.workspace_id !== ctx.workspace.id) return { error: "No encontré ese flujo." };
  return { ctx, found };
}

/** Prender o apagar un flujo del evento (F48). */
export async function toggleEventFlow(input: { flowId: string; enabled: boolean }): Promise<FlowActionResult<{ backfilled: number }>> {
  const owned = await ownedFlow(input.flowId);
  if (owned.error !== undefined) return { ok: false, error: owned.error };
  const { ctx, found } = owned;

  const { error } = await ctx.supabase
    .from("flows")
    .update({ status: input.enabled ? "published" : "draft" })
    .eq("id", input.flowId);
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };

  // El trigger se escribe desde el grafo, igual que al publicar desde el
  // canvas: así el flujo del evento y el del canvas guardan lo mismo.
  const desired = buildDesiredTriggers(found.nodes as unknown as Array<Record<string, unknown>>, input.flowId);
  await ctx.supabase.from("triggers").delete().eq("flow_id", input.flowId);
  if (desired.length > 0) {
    await ctx.supabase.from("triggers").insert(
      desired.map((t) => ({ ...t, workspace_id: ctx.workspace.id, is_active: input.enabled })),
    );
  }

  // Queda en el historial del EVENTO y no del flow: el flujo es del evento, y
  // el historial del evento es donde alguien lo va a buscar. Sumar una entidad
  // "flow" al audit log pediría revisar quién puede ver esas filas.
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "event_type",
    entityId: found.flow.event_type_id ?? input.flowId,
    action: "event_type.updated",
    metadata: { flow_id: input.flowId, enabled: input.enabled, name: found.flow.name },
    performedBy: ctx.user.id,
  });

  // Los avisos relativos de lo que ya está agendado.
  let backfilled = 0;
  if (input.enabled && desired.some((t) => isRelativeTrigger(t.type))) {
    backfilled = await backfillRelativeJobs(await createServiceClient(), ctx.workspace.id);
  }

  revalidatePath(`${PATH}/${found.flow.event_type_id}`);
  return { ok: true, data: { backfilled } };
}

/** Guardar el flujo desde el editor lineal (F57). */
export async function saveLinearFlow(input: { flowId: string; linear: LinearFlow }): Promise<FlowActionResult> {
  const owned = await ownedFlow(input.flowId);
  if (owned.error !== undefined) return { ok: false, error: owned.error };
  const { ctx, found } = owned;

  // Si el flujo tiene ramas, el editor lineal es de solo lectura: guardar
  // desde acá borraría la rama que no se veía.
  if (flowToLinear(found.nodes, found.edges) === null) {
    return { ok: false, error: "Este flujo tiene ramas: abrilo en el canvas para editarlo." };
  }

  const graph = linearToFlow(input.linear);
  const { error } = await ctx.supabase
    .from("flows")
    .update({ nodes: graph.nodes as unknown as Json, edges: graph.edges as unknown as Json })
    .eq("id", input.flowId);
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };

  // Si estaba publicado, el trigger se rehace con lo que quedó.
  if (found.flow.status === "published") {
    const desired = buildDesiredTriggers(graph.nodes as unknown as Array<Record<string, unknown>>, input.flowId);
    await ctx.supabase.from("triggers").delete().eq("flow_id", input.flowId);
    if (desired.length > 0) {
      await ctx.supabase.from("triggers").insert(desired.map((t) => ({ ...t, workspace_id: ctx.workspace.id, is_active: true })));
    }
  }

  revalidatePath(`${PATH}/${found.flow.event_type_id}`);
  return { ok: true };
}

/**
 * "Enviarme una prueba" (F57).
 *
 * Va SOLO al email de quien está editando, nunca al contacto, y se registra
 * con `kind: "flow_test"` para que no cuente como un envío al contacto en el
 * historial ni en los informes.
 *
 * Las variables se reemplazan con valores de ejemplo: el flujo todavía no
 * corrió, así que no hay una reunión de verdad de donde sacarlos.
 */
export async function sendFlowTestEmail(input: { flowId: string; subject: string; body: string }): Promise<FlowActionResult> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, error: "No tenés permiso." };
  const to = ctx.user.email ?? "";
  if (!to) return { ok: false, error: "Tu usuario no tiene email." };

  const sample = {
    contact: { first_name: "Noelia", name: "Noelia Mereles" },
    booking: {
      ...emptyBookingVariables(),
      event_title: "Llamada de diagnóstico",
      start_invitee: "martes 6 de octubre, 14:00 (hora de Ciudad de México)",
      time_invitee: "14:00",
      host_name: "Wendy",
      location: "Google Meet",
      meet_url: "https://meet.google.com/ejemplo",
      reschedule_url: "https://ejemplo/calendario/agenda/abc/reagendar",
      cancel_url: "https://ejemplo/calendario/agenda/abc",
    },
  };

  const result = await sendTransactionalEmail({
    workspaceId: ctx.workspace.id,
    to,
    subject: interpolateVariables(input.subject || "(sin asunto)", sample),
    html: bodyToHtml(interpolateVariables(input.body, sample)),
    kind: "flow_test",
    relatedEntityType: "flow",
    relatedEntityId: input.flowId,
    createdBy: ctx.user.id,
    deps: { supabase: await createServiceClient() },
  });

  if (!result.ok) {
    return { ok: false, error: result.reason === "not_configured" ? "Resend no está conectado: cargalo en Integraciones." : result.error };
  }
  return { ok: true };
}
