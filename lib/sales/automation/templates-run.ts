/**
 * Crea los cuatro flujos de cobranza APAGADOS (plano F38). Solo servidor. Idempotente por
 * `flows.template_key`: correrla dos veces no duplica nada, y un flujo que la persona ya editó, prendió o
 * borró no se vuelve a pisar ni a crear mientras exista (si lo borró, se vuelve a crear en la próxima
 * pasada: la forma de no tener los flujos es apagar la opción).
 *
 * Solo si `workspaces.sales_auto_create_flows` está prendido (por defecto sí). No hay backfill durante el
 * deploy: se llama al abrir Ventas por primera vez y al prender la opción en Ajustes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { SALES_FLOW_TEMPLATES, SALES_TEMPLATE_KEYS, salesTemplateGraph } from "./templates";

type Db = SupabaseClient<Database>;

export async function ensureSalesTemplateFlows(db: Db, workspaceId: string, options: { force?: boolean } = {}): Promise<number> {
  try {
    if (!options.force) {
      const { data: workspace } = await db.from("workspaces").select("sales_auto_create_flows").eq("id", workspaceId).maybeSingle();
      if ((workspace as { sales_auto_create_flows?: boolean } | null)?.sales_auto_create_flows === false) return 0;
    }
    const { data: existing } = await db.from("flows").select("template_key").eq("workspace_id", workspaceId).in("template_key", [...SALES_TEMPLATE_KEYS]);
    const already = new Set((existing ?? []).map((f) => (f as { template_key?: string | null }).template_key).filter(Boolean));

    const rows = SALES_FLOW_TEMPLATES.filter((t) => !already.has(t.key)).map((template) => {
      const graph = salesTemplateGraph(template);
      return {
        workspace_id: workspaceId,
        name: template.name,
        description: template.describe,
        // Apagado: la fila de `triggers` se escribe recién al publicar.
        status: "draft" as const,
        nodes: graph.nodes as unknown as Json,
        edges: graph.edges as unknown as Json,
        template_key: template.key,
      };
    });
    if (rows.length === 0) return 0;

    const { error, count } = await db.from("flows").insert(rows, { count: "exact" });
    if (error) {
      console.error("[ventas] no pude crear los flujos de cobranza:", error.message);
      return 0;
    }
    return count ?? rows.length;
  } catch (error) {
    console.error("[ventas] los flujos de cobranza fallaron:", error instanceof Error ? error.message : "error");
    return 0;
  }
}
