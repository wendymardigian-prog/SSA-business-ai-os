/**
 * Los flujos de un formulario (F21). Solo servidor.
 *
 * Un flujo pertenece a un formulario por `flows.form_id` (migración 00155), igual
 * que `event_type_id` en la Agenda. Un flujo es un flow normal: aparece también
 * en la pantalla general de Automatizaciones.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";
import { describeFormTrigger } from "@/lib/forms/automation/trigger-config";

type Db = SupabaseClient<Database>;

export interface FormFlowRow {
  id: string;
  name: string;
  /** Encendido = el flow está publicado y su trigger activo. */
  enabled: boolean;
  /** "Se envía un formulario en «Aplicación»". */
  describe: string;
}

export async function flowsForForm(supabase: Db, formId: string, formNames: Record<string, string> = {}): Promise<FormFlowRow[]> {
  const { data: flows } = await supabase
    .from("flows")
    .select("id, name, status")
    .eq("form_id", formId)
    .order("created_at", { ascending: true });
  if (!flows || flows.length === 0) return [];

  const { data: triggers } = await supabase
    .from("triggers")
    .select("flow_id, type, config, is_active")
    .in("flow_id", flows.map((f) => f.id));
  const byFlow = new Map((triggers ?? []).map((t) => [t.flow_id, t]));

  return flows.map((flow) => {
    const trigger = byFlow.get(flow.id);
    return {
      id: flow.id,
      name: flow.name,
      enabled: flow.status === "published" && Boolean(trigger?.is_active),
      describe: trigger ? describeFormTrigger(trigger.type, trigger.config, formNames) : "Sin disparador",
    };
  });
}

/** El grafo guardado de un flow de formulario, para el editor lineal. `null` si no existe. */
export async function formFlowGraph(supabase: Db, flowId: string) {
  const { data: flow } = await supabase
    .from("flows")
    .select("id, name, status, form_id, workspace_id, nodes, edges")
    .eq("id", flowId)
    .maybeSingle();
  if (!flow) return null;
  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []) as unknown as CanvasNode[];
  const edges = (Array.isArray(flow.edges) ? flow.edges : []) as unknown as CanvasEdge[];
  return { flow, nodes, edges };
}
