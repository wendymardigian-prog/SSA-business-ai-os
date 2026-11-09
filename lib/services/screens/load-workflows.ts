// @plantilla-quitar(servicios)
/**
 * Los workflows del camino de una variante (F117), con sus cuentas de 30 días. Solo servidor. Con el cliente del
 * USUARIO: quien no ve Automatizaciones no ve ninguno (la RLS de `flows`), y las ejecuciones las decide
 * `can_see_flow_session`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import "@/lib/flow-engine/registry";
import { getNodeByType } from "@/lib/flow-engine/registry/registry";
import { SERVICE_TRIGGER_TYPES } from "../automation";
import { chipsFor, slotOf, triggerOf, type CanvasEdgeLike, type CanvasNodeLike, type PathWorkflow } from "./workflow-chips";

type Db = SupabaseClient<any, any, any>;

const labelFor = (type: string) => getNodeByType(type)?.label ?? type;

export async function loadPathWorkflows(supabase: Db, workspaceId: string, variantId: string): Promise<PathWorkflow[]> {
  const { data: flows, error } = await supabase.from("flows").select("id, name, status, nodes, draft_nodes, edges, draft_edges").eq("workspace_id", workspaceId);
  if (error) {
    console.error("[servicios] no pude leer las automatizaciones del camino:", error.message);
    return [];
  }
  const serviceTypes = new Set<string>(SERVICE_TRIGGER_TYPES);
  const mine = ((flows ?? []) as Array<Record<string, unknown>>)
    .map((f) => {
      const nodes = ((Array.isArray(f.draft_nodes) ? f.draft_nodes : f.nodes) ?? []) as CanvasNodeLike[];
      const edges = ((Array.isArray(f.draft_edges) ? f.draft_edges : f.edges) ?? []) as CanvasEdgeLike[];
      const trigger = triggerOf(nodes);
      if (!trigger || !serviceTypes.has(String(trigger.triggerType))) return null;
      const slot = slotOf(variantId, trigger);
      return slot ? { id: f.id as string, name: f.name as string, status: f.status as string, slot, chips: chipsFor(nodes, edges, labelFor) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (mine.length === 0) return [];

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: sessions } = await supabase
    .from("flow_sessions")
    .select("id, flow_id, status")
    .in("flow_id", mine.map((m) => m.id))
    .gte("created_at", since);
  const list = (sessions ?? []) as Array<{ id: string; flow_id: string; status: string }>;
  const failedSessions = new Set<string>();
  if (list.length > 0) {
    const { data: steps } = await supabase.from("flow_session_steps").select("session_id").in("session_id", list.map((s) => s.id).slice(0, 1000)).eq("status", "failed");
    for (const s of (steps ?? []) as Array<{ session_id: string }>) failedSessions.add(s.session_id);
  }
  return mine.map((m) => {
    const own = list.filter((s) => s.flow_id === m.id);
    return {
      ...m,
      runs30d: own.length,
      failed30d: own.filter((s) => failedSessions.has(s.id)).length,
      waiting: own.filter((s) => s.status === "active").length,
    };
  });
}
