"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import { flowGraph } from "@/lib/scheduling/data/event-flows";
import { flowToLinear, linearToFlow, type LinearFlow } from "@/lib/scheduling/automation/linear-flow";
import { prepareTreeSave } from "@/lib/automations/step-tree-save";
import type { StepTree } from "@/lib/automations/step-tree";
import { backfillRelativeJobs } from "@/lib/scheduling/automation/relative";
import { isRelativeTrigger } from "@/lib/scheduling/automation/triggers";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { sendTransactionalEmail } from "@/lib/email/send";
import { bodyToHtml } from "@/lib/flow-engine/nodes/send-email";
import { connectionProblemsForGraph } from "@/lib/flow-engine/connection-problems";
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
  if (!found || found.flow.workspace_id !== ctx.workspace.id || !found.flow.event_type_id) return { error: "No encontré ese flujo." };
  // El flujo es del evento: lo toca quien puede editar ese evento (su dueño, o
  // quien gestiona agendas de otros), igual que \`ownerOf\` en event-types.ts.
  // Sin esto, cualquiera con la agenda prendía o editaba los flujos de otro.
  const { data: event } = await ctx.supabase
    .from("event_types")
    .select("owner_user_id")
    .eq("id", found.flow.event_type_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!event) return { error: "No encontré ese flujo." };
  if (event.owner_user_id !== ctx.user.id && !ctx.can("scheduling.manage_others")) {
    return { error: "No tenés permiso para tocar los flujos de un evento de otra persona." };
  }
  return { ctx, found };
}

/** Prender o apagar un flujo del evento (F48). */
export async function toggleEventFlow(input: { flowId: string; enabled: boolean }): Promise<FlowActionResult<{ backfilled: number }>> {
  const owned = await ownedFlow(input.flowId);
  if (owned.error !== undefined) return { ok: false, error: owned.error };
  const { ctx, found } = owned;

  // Prender un flujo con un paso que necesita una conexion que falta seria prometer algo que no se va a ejecutar (G1.4).
  // Apagarlo siempre se puede. El borrador se guarda igual; esto solo se mira al prender.
  if (input.enabled) {
    const problems = await connectionProblemsForGraph(createServiceClient, ctx.workspace.id, found.nodes as unknown[], found.edges as unknown[]);
    if (problems.length > 0) return { ok: false, error: problems.join(" ") };
  }

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
 * Guardar el flujo desde el editor de pasos (arbol con Condiciones).
 *
 * Se niega si el grafo guardado no es un arbol (fusion, A/B, ciclo: eso se edita en
 * el canvas), valida el arbol entero (`prepareTreeSave`: pasos permitidos en la
 * Agenda, caminos de Condiciones, forma posible) y el disparador es SIEMPRE el
 * guardado: el editor de pasos no lo toca. Rehace los triggers si el flujo esta
 * encendido, igual que `saveLinearFlow`.
 */
export async function saveEventFlowTree(input: { flowId: string; tree: Pick<StepTree, "steps"> }): Promise<FlowActionResult> {
  const owned = await ownedFlow(input.flowId);
  if (owned.error !== undefined) return { ok: false, error: owned.error };
  const { ctx, found } = owned;

  const prepared = prepareTreeSave({ screen: "agenda", stored: { nodes: found.nodes, edges: found.edges }, tree: input.tree });
  if (!prepared.ok) return { ok: false, error: prepared.error };
  const graph = prepared.graph;

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

  const hostName =
    ctx.user.user_metadata?.full_name ?? ctx.user.user_metadata?.name ?? ctx.user.email ?? "Alguien";
  const sample = {
    contact: { first_name: "Ana", name: "Ana Pérez" },
    booking: {
      ...emptyBookingVariables(),
      event_title: "Llamada de diagnóstico",
      start_invitee: "martes 6 de octubre, 14:00 (hora de Ciudad de México)",
      time_invitee: "14:00",
      host_name: hostName,
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
