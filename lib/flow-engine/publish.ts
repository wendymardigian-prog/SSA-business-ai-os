/**
 * Publicar y despublicar un flujo desde el servidor (Tareas × CRM, R5).
 *
 * Es la logica de `POST /api/v1/flows/[flowId]/publish`, sacada tal cual a una funcion para que otro codigo del servidor
 * (el interruptor de cobranza de Ajustes) publique con los MISMOS pasos y la MISMA validacion, sin pasar por HTTP. La ruta
 * la llama y devuelve lo mismo que siempre (mismos cuerpos y mismos codigos).
 *
 *   1. Lee el flujo del workspace (404 si no esta).
 *   2. Valida con `checkMemberFlow` (un flujo sin contacto no se publica con pasos que lo necesiten) y, si se le pasa, con
 *      una validacion extra (`extraProblems`): 400 con los problemas, sin escribir nada.
 *   3. `flows`: estado publicado, fecha y version + 1. `flow_versions`: la foto de esta version.
 *   4. `triggers`: se borran las filas del flujo que maneja el editor (sin canal) y se escriben las que salen de sus nodos
 *      disparador; se activan todas. Los recordatorios relativos a un pago ya existente se agendan.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDesiredTriggers, persistableTriggerTypes } from "@/lib/flow-triggers";
import { backfillPaymentRelativeJobs } from "@/lib/sales/automation/relative"; // @plantilla-quitar(ventas)
import { isRelativeSalesTrigger } from "@/lib/sales/automation/triggers"; // @plantilla-quitar(ventas)
import type { Database, Json } from "@/lib/types/database";
import { checkMemberFlow } from "./member-flow-db";
import { connectionProblemsForGraph } from "./connection-problems";
import { triggerProblems } from "./publish-rules";

type Db = SupabaseClient<Database>;
type FlowRow = Database["public"]["Tables"]["flows"]["Row"];

export interface PublishFlowArgs {
  /** El cliente con el que se lee y escribe (la sesion de la persona o el de servicio). */
  db: Db;
  /** Quien lo publica (queda en la foto de la version). */
  userId: string | null;
  workspaceId: string;
  flowId: string;
  /** El cliente de servicio para agendar los recordatorios de pagos. Se pide solo si hace falta. */
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

  // Un flujo sin contacto (reporte de fin de día, E15) no se publica con pasos que necesiten uno. Tampoco con pasos
  // que necesitan una conexion que falta (Resend, WhatsApp, una IA...): se puede armar y guardar el borrador, pero
  // publicarlo seria prometer algo que no se va a ejecutar (G1).
  const problems = [
    // La validacion propia de quien publica (las plantillas del servidor) va primero: su motivo es el mas especifico.
    ...(args.extraProblems?.(nodes, edges) ?? []),
    // Un solo disparador, elegido, con lo minimo de su tipo y con un paso conectado (auditoria de automatizaciones).
    ...triggerProblems(nodes, edges),
    ...(await checkMemberFlow(db, workspaceId, nodes, edges, { publishing: true })),
    ...(await connectionProblemsForGraph(args.getServiceClient, workspaceId, nodes, edges)),
  ];
  if (problems.length > 0) return { ok: false, status: 400, error: problems[0], problems };

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
  // `comment_keyword`: builder-created rows are workspace-wide (channel_id null), while
  // Growth-tab rows are channel-scoped (channel_id set) and must survive republish —
  // hence the null-channel guard on the delete below. A comment_keyword node with
  // "also match in DMs" emits a second row typed `keyword` (see below), so both rows
  // are reconciled together on every republish.
  const flowNodes = nodes as Array<Record<string, unknown>>;
  const desiredTriggers = buildDesiredTriggers(flowNodes, flowId);

  // Reconcile: clear the builder-managed trigger rows for this flow, then insert the
  // fresh set derived from the current node graph (delete-and-reinsert keeps the table
  // in sync with what was published and avoids duplicates on republish). Only
  // null-channel rows are builder-managed; channel-scoped rows belong to the Growth tab.
  await db
    .from("triggers")
    .delete()
    .eq("flow_id", flowId)
    .is("channel_id", null)
    // TODOS los tipos que arma el editor (mensaje, eventos, programados y Ventas): republicar no duplica ninguna fila.
    // Antes solo se borraban los de mensaje y Ventas, y un flujo de agenda republicado tres veces corria tres veces.
    .in("type", persistableTriggerTypes());

  if (desiredTriggers.length > 0) {
    const { error: insertError } = await db.from("triggers").insert(desiredTriggers);
    if (insertError) {
      console.error("[publish] Failed to sync triggers from flow nodes:", insertError);
    }
  }

  // Las filas con canal (las de la pestaña Growth) NO se reactivan: si alguien apago una a mano, publicar no la vuelve
  // a prender. Las que arma el editor ya nacen activas.

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
    .is("channel_id", null)
    .in("type", persistableTriggerTypes());
  if (triggersError) {
    console.error("[publish] no pude sacar los disparadores del flujo:", triggersError.message);
    return false;
  }
  return true;
}

