"use server";

import { revalidatePath } from "next/cache";
import { getAnyPermissionAction, type PermissionContext } from "@/lib/auth/guards";
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
import { lowerFirst, replaceFlowTriggers } from "@/lib/flow-triggers-replace";
import { sendTransactionalEmail } from "@/lib/email/send";
import { bodyToHtml } from "@/lib/flow-engine/nodes/send-email";
import { connectionProblemsForGraph } from "@/lib/flow-engine/connection-problems";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { emptyBookingVariables } from "@/lib/scheduling/automation/variables";
import { isNoEventTemplateKey } from "@/lib/scheduling/automation/templates";
import { NO_EVENT_FLOWS_PATH } from "@/lib/scheduling/booking/guest-notice";

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
  | { error: string; ctx?: undefined; found?: undefined; db?: undefined; path?: undefined }
  | {
      error?: undefined;
      ctx: PermissionContext;
      found: NonNullable<Awaited<ReturnType<typeof flowGraph>>>;
      /** Con que cliente se escribe: el de la persona, o el de servicio en un flujo del negocio. */
      db: PermissionContext["supabase"];
      /** La pantalla que hay que refrescar. */
      path: string;
    };

async function ownedFlow(flowId: string): Promise<OwnedFlow> {
  const ctx = await getAnyPermissionAction(["scheduling.use", "settings.general"]);
  if (!ctx) return { error: "No tenés permiso para tocar los flujos." };

  // "Reuniones sin evento" es del negocio, no de una persona: pide `settings.general` y escribe el servidor
  // despues de chequearlo, igual que las demas opciones del workspace. La RLS de `flows` pide otras claves.
  const service = await createServiceClient();
  const peek = await flowGraph(service, flowId);
  if (peek && peek.flow.workspace_id === ctx.workspace.id && !peek.flow.event_type_id && isNoEventTemplateKey(peek.flow.template_key)) {
    if (!ctx.can("settings.general")) return { error: "No tenés permiso para cambiar los flujos de las reuniones sin evento." };
    return { ctx, found: peek, db: service as unknown as PermissionContext["supabase"], path: NO_EVENT_FLOWS_PATH };
  }

  if (!ctx.can("scheduling.use")) return { error: "No tenés permiso para tocar los flujos." };
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
  return { ctx, found, db: ctx.supabase, path: `${PATH}/${found.flow.event_type_id}` };
}

/** Prender o apagar un flujo del evento (F48). */
export async function toggleEventFlow(input: { flowId: string; enabled: boolean }): Promise<FlowActionResult<{ backfilled: number }>> {
  const owned = await ownedFlow(input.flowId);
  if (owned.error !== undefined) return { ok: false, error: owned.error };
  const { ctx, found, db, path } = owned;

  // Prender un flujo con un paso que necesita una conexion que falta seria prometer algo que no se va a ejecutar (G1.4).
  // Apagarlo siempre se puede. El borrador se guarda igual; esto solo se mira al prender.
  if (input.enabled) {
    const problems = await connectionProblemsForGraph(createServiceClient, ctx.workspace.id, found.nodes as unknown[], found.edges as unknown[]);
    if (problems.length > 0) return { ok: false, error: problems.join(" ") };
  }

  const { error } = await db
    .from("flows")
    .update({ status: input.enabled ? "published" : "draft" })
    .eq("id", input.flowId);
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };

  // El trigger se escribe desde el grafo, igual que al publicar desde el
  // canvas: así el flujo del evento y el del canvas guardan lo mismo.
  const desired = buildDesiredTriggers(found.nodes as unknown as Array<Record<string, unknown>>, input.flowId);
  const triggers = await replaceFlowTriggers(db, { flowId: input.flowId, workspaceId: ctx.workspace.id, desired, isActive: input.enabled });
  if (!triggers.ok) {
    // Sin disparador el cambio no sirve: el flujo vuelve al estado que tenia (mejor esfuerzo).
    const { error: revertError } = await db.from("flows").update({ status: found.flow.status }).eq("id", input.flowId);
    if (revertError) console.error("[event-flows] no pude volver el flujo a su estado:", revertError.message);
    return { ok: false, error: triggers.error };
  }

  // Queda en el historial del EVENTO y no del flow: el flujo es del evento, y
  // el historial del evento es donde alguien lo va a buscar. Sumar una entidad
  // "flow" al audit log pediría revisar quién puede ver esas filas.
  await logAudit({
    supabase: db,
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

  revalidatePath(path);
  return { ok: true, data: { backfilled } };
}

/** Guardar el flujo desde el editor lineal (F57). */
export async function saveLinearFlow(input: { flowId: string; linear: LinearFlow }): Promise<FlowActionResult> {
  const owned = await ownedFlow(input.flowId);
  if (owned.error !== undefined) return { ok: false, error: owned.error };
  const { ctx, found, db, path } = owned;

  // Si el flujo tiene ramas, el editor lineal es de solo lectura: guardar
  // desde acá borraría la rama que no se veía.
  if (flowToLinear(found.nodes, found.edges) === null) {
    return { ok: false, error: "Este flujo tiene ramas: abrilo en el canvas para editarlo." };
  }

  const graph = linearToFlow(input.linear);
  const { error } = await db
    .from("flows")
    .update({ nodes: graph.nodes as unknown as Json, edges: graph.edges as unknown as Json })
    .eq("id", input.flowId);
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };

  // Si estaba publicado, el trigger se rehace con lo que quedó.
  if (found.flow.status === "published") {
    const desired = buildDesiredTriggers(graph.nodes as unknown as Array<Record<string, unknown>>, input.flowId);
    const triggers = await replaceFlowTriggers(db, { flowId: input.flowId, workspaceId: ctx.workspace.id, desired, isActive: true });
    if (!triggers.ok) return { ok: false, error: `Guardé los pasos, pero ${lowerFirst(triggers.error)}` };
  }

  revalidatePath(path);
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
  const { ctx, found, db, path } = owned;

  const prepared = prepareTreeSave({ screen: "agenda", stored: { nodes: found.nodes, edges: found.edges }, tree: input.tree });
  if (!prepared.ok) return { ok: false, error: prepared.error };
  const graph = prepared.graph;

  const { error } = await db
    .from("flows")
    .update({ nodes: graph.nodes as unknown as Json, edges: graph.edges as unknown as Json })
    .eq("id", input.flowId);
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };

  // Si estaba publicado, el trigger se rehace con lo que quedó.
  if (found.flow.status === "published") {
    const desired = buildDesiredTriggers(graph.nodes as unknown as Array<Record<string, unknown>>, input.flowId);
    const triggers = await replaceFlowTriggers(db, { flowId: input.flowId, workspaceId: ctx.workspace.id, desired, isActive: true });
    if (!triggers.ok) return { ok: false, error: `Guardé los pasos, pero ${lowerFirst(triggers.error)}` };
  }

  revalidatePath(path);
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
  const ctx = await getAnyPermissionAction(["scheduling.use", "settings.general"]);
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
      meeting_place: "Google Meet: https://meet.google.com/ejemplo",
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
