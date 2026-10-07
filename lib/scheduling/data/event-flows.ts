/**
 * Los flujos de un evento (F48). Solo servidor.
 *
 * Un flujo pertenece a un evento por `flows.event_type_id` (migración 00098).
 * Los siete sugeridos además llevan `template_key`, que es lo que permite
 * reconocerlos y no duplicarlos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { describeTrigger, type BookingTriggerConfig } from "@/lib/scheduling/automation/triggers";
import { templateByKey } from "@/lib/scheduling/automation/templates";
import type { CanvasEdge, CanvasNode } from "@/lib/scheduling/automation/linear-flow";

type Db = SupabaseClient<Database>;

export interface EventFlowRow {
  id: string;
  name: string;
  templateKey: string | null;
  /** Encendido = el flow está publicado y su trigger activo. */
  enabled: boolean;
  triggerId: string | null;
  triggerType: string | null;
  /** "24 horas antes de la reunión · Email al contacto". */
  describe: string;
}

export async function flowsForEventType(supabase: Db, eventTypeId: string): Promise<EventFlowRow[]> {
  const { data: flows } = await supabase
    .from("flows")
    .select("id, name, status, template_key")
    .eq("event_type_id", eventTypeId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (!flows || flows.length === 0) return [];

  const { data: triggers } = await supabase
    .from("triggers")
    .select("id, flow_id, type, config, is_active")
    .in("flow_id", flows.map((f) => f.id));

  const byFlow = new Map<string, { id: string; type: string; config: BookingTriggerConfig; is_active: boolean }>();
  for (const t of triggers ?? []) {
    byFlow.set(t.flow_id, { id: t.id, type: t.type, config: (t.config ?? {}) as BookingTriggerConfig, is_active: t.is_active });
  }

  return flows.map((flow) => {
    const trigger = byFlow.get(flow.id);
    const template = flow.template_key ? templateByKey(flow.template_key) : undefined;
    const cuando = trigger ? describeTrigger(trigger.type, trigger.config) : "Sin disparador";
    return {
      id: flow.id,
      name: flow.name,
      templateKey: flow.template_key ?? null,
      enabled: flow.status === "published" && Boolean(trigger?.is_active),
      triggerId: trigger?.id ?? null,
      triggerType: trigger?.type ?? null,
      describe: template?.describe ?? cuando,
    };
  });
}

/**
 * El grafo guardado de un flow, para el editor lineal.
 *
 * Los nodos y las aristas viven en dos columnas jsonb de `flows`, no en tablas
 * aparte: es como lo guarda el canvas desde el sistema original.
 */
export async function flowGraph(supabase: Db, flowId: string) {
  const { data: flow } = await supabase
    .from("flows")
    .select("id, name, status, event_type_id, template_key, workspace_id, nodes, edges")
    .eq("id", flowId)
    .maybeSingle();
  if (!flow) return null;

  const nodes = (Array.isArray(flow.nodes) ? flow.nodes : []) as unknown as CanvasNode[];
  const edges = (Array.isArray(flow.edges) ? flow.edges : []) as unknown as CanvasEdge[];
  return { flow, nodes, edges };
}
