/**
 * Publicar y despublicar un flujo desde el servidor (R5).
 *
 * Es la logica de `POST /api/v1/flows/[flowId]/publish`, sacada tal cual a una funcion para que otro codigo del servidor
 * (por ejemplo, un interruptor de Ajustes) publique con los MISMOS pasos y la MISMA validacion, sin pasar por HTTP. La ruta
 * la llama y devuelve lo mismo que siempre (mismos cuerpos y mismos codigos).
 *
 *   1. Lee el flujo del workspace (404 si no esta).
 *   2. Valida con `checkMemberFlow` (un flujo sin contacto no se publica con pasos que lo necesiten) y, si se le pasa, con
 *      una validacion extra (`extraProblems`): 400 con los problemas, sin escribir nada.
 *   3. `flows`: estado publicado, fecha y version + 1. `flow_versions`: la foto de esta version.
 *   4. `triggers`: se borran las filas del flujo que maneja el editor (sin canal) y se escriben las que salen de sus nodos
 *      disparador; se activan todas. Los recordatorios relativos a un pago ya existente se agendan.
 *   5. «En una fecha y hora»: se anula la vez pendiente de la version anterior y se agenda la proxima de esta. Una sola
 *      vez que ya paso no se publica (no correria nunca).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { emailAttachmentProblems } from "@/lib/email/attachment-limits";
import { configProblems } from "./node-requirements";
import { buildDesiredTriggers, CANVAS_TRIGGER_ROWS_FILTER, persistableTriggerTypes } from "@/lib/flow-triggers";
import { backfillPaymentRelativeJobs } from "@/lib/sales/automation/relative"; // @plantilla-quitar(ventas)
import { isRelativeSalesTrigger } from "@/lib/sales/automation/triggers"; // @plantilla-quitar(ventas)
import type { Database, Json } from "@/lib/types/database";
import { checkMemberFlow } from "./member-flow-db";
import { connectionProblemsForGraph } from "./connection-problems";
import { chosenTriggerType, triggerNodesOf, triggerProblems } from "./publish-rules";
import { nextOccurrence, SCHEDULE_PAST_PROBLEM, SCHEDULED_TRIGGER_TYPE, scheduleProblems } from "@/lib/scheduled-flows/schedule";
import { businessTimeZone, syncScheduledRuns } from "@/lib/scheduled-flows/jobs";

type Db = SupabaseClient<Database>;
type FlowRow = Database["public"]["Tables"]["flows"]["Row"];

export interface PublishFlowArgs {
  /** El cliente con el que se lee y escribe (la sesion de la persona o el de servicio). */
  db: Db;
  /** Quien lo publica (queda en la foto de la version). */
  userId: string | null;
  workspaceId: string;
  flowId: string;
  /** El cliente de servicio, para lo que haya que agendar al publicar. Se pide solo si hace falta. */
  getServiceClient: () => Promise<Db>;
  /** Una validacion extra (solo las plantillas del servidor la usan). Devuelve los problemas, o `[]`. */
  extraProblems?: (nodes: unknown[], edges: unknown[]) => string[];
}

export type PublishFlowResult =
  | { ok: true; flow: FlowRow; version: number }
  | { ok: false; status: 400 | 404; error: string; problems?: string[] };

export async function publishFlow(args: PublishFlowArgs): Promise<PublishFlowResult> {
  const { db, userId, workspaceId, flowId } = args;

  // Get current flow
  const { data: flow, error } = await db.from("flows").select("*").eq("id", flowId).eq("workspace_id", workspaceId).single();
  if (error || !flow) return { ok: false, status: 404, error: "No encontré esa automatización." };

  // Una automatizacion publicada con cambios sin publicar (00254): se publica el BORRADOR. Lo que corria hasta ahora
  // (`nodes`) se reemplaza recien aca, despues de validar.
  const hasDraft = Array.isArray(flow.draft_nodes);
  const nodes = hasDraft ? (flow.draft_nodes as unknown[]) : Array.isArray(flow.nodes) ? (flow.nodes as unknown[]) : [];
  const edges = hasDraft
    ? Array.isArray(flow.draft_edges) ? (flow.draft_edges as unknown[]) : []
    : Array.isArray(flow.edges) ? (flow.edges as unknown[]) : [];

  // Un flujo sin contacto no se publica con pasos que necesiten uno. Tampoco con pasos
  // que necesitan una conexion que falta (Resend, WhatsApp, una IA...): se puede armar y guardar el borrador, pero
  // publicarlo seria prometer algo que no se va a ejecutar (G1).
  const problems = [
    // La validacion propia de quien publica (las plantillas del servidor) va primero: su motivo es el mas especifico.
    ...(args.extraProblems?.(nodes, edges) ?? []),
    // Un solo disparador, elegido, con lo minimo de su tipo y con un paso conectado (auditoria de automatizaciones).
    ...triggerProblems(nodes, edges),
    ...emailAttachmentProblems(nodes),
    // Un paso sin lo minimo de su configuracion (Diseñador IA: «Generar desde plantilla» sin plantilla).
    ...configProblems(nodes as never, edges as never),
    ...(await checkMemberFlow(db, workspaceId, nodes, edges, { publishing: true })),
    ...(await connectionProblemsForGraph(args.getServiceClient, workspaceId, nodes, edges)),
    ...(await schedulePastProblems(db, workspaceId, nodes)),
  ];
  if (problems.length > 0) return { ok: false, status: 400, error: problems[0], problems };

  // Si lo que corria hasta ahora era «En una fecha y hora» (se mira ANTES de reemplazarlo): su vez pendiente se anula.
  const wasScheduled = hasScheduledTrigger(Array.isArray(flow.nodes) ? (flow.nodes as unknown[]) : []);

  // Update flow status to published and increment version
  const newVersion = flow.version + 1;
  await db
    .from("flows")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      version: newVersion,
      // Lo publicado pasa a ser lo que corre, y el borrador se vacia.
      ...(hasDraft ? { nodes: nodes as Json, edges: edges as Json, draft_nodes: null, draft_edges: null, draft_updated_at: null } : {}),
    })
    .eq("id", flowId);

  // Save version snapshot
  await db.from("flow_versions").insert({
    flow_id: flowId,
    version: newVersion,
    nodes: nodes as Json,
    edges: edges as Json,
    viewport: flow.viewport,
    name: flow.name,
    published_by: userId,
  });

  // Sync trigger rows from the flow's trigger nodes into the `triggers` table.
  // The runtime matcher (lib/flow-engine/trigger-matcher.ts) reads triggers.config,
  // but the builder only ever saved keywords into flows.nodes — so triggers configured
  // in the UI never fired in production. Reconcile them here on publish. This includes
  // `comment_keyword`. El lienzo es el dueno de sus filas: sin canal, o con canal y la marca `origin: "canvas"` (el
  // disparador de comentario elige su cuenta). Una regla vieja de la pestana Growth (con canal, sin marca) no se toca.
  // A comment_keyword node with
  // "also match in DMs" emits a second row typed `keyword` (see below), so both rows
  // are reconciled together on every republish.
  const flowNodes = nodes as Array<Record<string, unknown>>;
  const desiredTriggers = buildDesiredTriggers(flowNodes, flowId);

  // Reconcile: clear the builder-managed trigger rows for this flow, then insert the
  // fresh set derived from the current node graph (delete-and-reinsert keeps the table
  // in sync with what was published and avoids duplicates on republish).
  await db
    .from("triggers")
    .delete()
    .eq("flow_id", flowId)
    .or(CANVAS_TRIGGER_ROWS_FILTER)
    // TODOS los tipos que arma el editor (mensaje, eventos, programados...): republicar no duplica ninguna fila.
    .in("type", persistableTriggerTypes());

  if (desiredTriggers.length > 0) {
    const { error: insertError } = await db.from("triggers").insert(desiredTriggers);
    if (insertError) {
      console.error("[publish] Failed to sync triggers from flow nodes:", insertError);
    }
  }

  // Las reglas viejas de la pestaña Growth NO se reactivan: si alguien apago una a mano, publicar no la vuelve
  // a prender. Las que arma el editor ya nacen activas.

  // «En una fecha y hora»: la proxima vez de ESTA version (y se anula la pendiente de la anterior). Tambien si la
  // version anterior era programada y esta ya no: su vez pendiente no tiene que correr. Nunca frena la publicacion.
  const scheduled = desiredTriggers.find((t) => t.type === SCHEDULED_TRIGGER_TYPE);
  if (scheduled || wasScheduled) {
    try {
      await syncScheduledRuns(await args.getServiceClient(), { workspaceId, flowId, version: newVersion, config: scheduled ? scheduled.config : null });
    } catch (scheduleError) {
      console.error("[publish] no pude agendar la automatizacion programada:", scheduleError instanceof Error ? scheduleError.message : "error");
    }
  }

  // @plantilla-desde(ventas)
  // Un flujo con un recordatorio relativo al vencimiento de un pago (Ventas, F37): se agendan los de los
  // pagos que ya existen. Sin esto el recordatorio valdria solo para los pagos nuevos.
  if (desiredTriggers.some((t) => isRelativeSalesTrigger(t.type))) {
    try {
      await backfillPaymentRelativeJobs(await args.getServiceClient(), workspaceId);
    } catch (backfillError) {
      console.error("[publish] no pude agendar los recordatorios de pagos:", backfillError instanceof Error ? backfillError.message : "error");
    }
  }
  // @plantilla-hasta(ventas)

  return { ok: true, flow: { ...(flow as FlowRow), nodes: nodes as Json, edges: edges as Json }, version: newVersion };
}

/** Si el disparador de estos nodos es «En una fecha y hora». */
function hasScheduledTrigger(nodes: unknown[]): boolean {
  const triggers = triggerNodesOf(nodes);
  return triggers.length > 0 && chosenTriggerType(triggers[0]) === SCHEDULED_TRIGGER_TYPE;
}

/**
 * Una automatizacion «En una fecha y hora» que no tiene ninguna vez por delante (una sola vez que ya paso) no se publica:
 * no correria nunca. Se mira en la zona del negocio; si no se puede leer, no se frena (la cola lo vuelve a mirar).
 */
async function schedulePastProblems(db: Db, workspaceId: string, nodes: unknown[]): Promise<string[]> {
  if (!hasScheduledTrigger(nodes)) return [];
  const data = (triggerNodesOf(nodes)[0].data ?? {}) as Record<string, unknown>;
  const config = { ...((data.config ?? {}) as Record<string, unknown>), ...data };
  // Lo que falta (la fecha, la hora) ya lo dice `triggerProblems`.
  if (scheduleProblems(config).length > 0) return [];
  try {
    const timeZone = await businessTimeZone(db, workspaceId);
    return nextOccurrence(config, new Date(), timeZone) ? [] : [SCHEDULE_PAST_PROBLEM];
  } catch (err) {
    console.error("[publish] no pude leer la zona del negocio para la fecha programada:", err instanceof Error ? err.message : "error");
    return [];
  }
}

/**
 * Pasa un flujo publicado a borrador y le saca sus disparadores (no se borra el flujo ni su historial de versiones). Un
 * flujo en borrador no corre. Devuelve si pudo escribir.
 */
export async function unpublishFlow(db: Db, workspaceId: string, flowId: string): Promise<boolean> {
  const { error } = await db.from("flows").update({ status: "draft" }).eq("id", flowId).eq("workspace_id", workspaceId);
  if (error) {
    console.error("[publish] no pude pasar el flujo a borrador:", error.message);
    return false;
  }
  const { error: triggersError } = await db
    .from("triggers")
    .delete()
    .eq("flow_id", flowId)
    .or(CANVAS_TRIGGER_ROWS_FILTER)
    .in("type", persistableTriggerTypes());
  if (triggersError) {
    console.error("[publish] no pude sacar los disparadores del flujo:", triggersError.message);
    return false;
  }
  return true;
}

