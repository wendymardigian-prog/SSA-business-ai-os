import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadAutomationCapabilities } from "@/lib/flow-engine/capabilities";
import { REQUIREMENT_INFO, blockedNodes, requirementsOfNode, type GraphEdgeLike, type GraphNodeLike } from "@/lib/flow-engine/node-requirements";
import { triggerDisplayLabel } from "@/lib/flow-engine/trigger-catalog";
import { flowOrigin, parseFlowListQuery, type FlowListRow } from "@/lib/flows/list";
import { normalizeCategories } from "@/lib/flows/categories";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import type { FlowStatus } from "@/lib/types/database";
import { FlowsList } from "@/components/flows/flows-list";

/**
 * La lista de automatizaciones. Arma en el servidor lo que cada tarjeta muestra (como arranca, cuantos pasos, si hay
 * pasos que no se van a ejecutar) y al navegador viaja solo eso: los pasos enteros no hacen falta para la lista.
 */
export default async function FlowsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Equipo y roles (F22): la pagina pide su permiso.
  const ctx = await requirePermission("flows.view");
  const { workspace, supabase } = await getWorkspace();
  const sp = await searchParams;

  const [{ data: flows }, { count: channelCount }, timeZone] = await Promise.all([
    supabase
      .from("flows")
      .select("id, name, description, categories, status, updated_at, nodes, edges, draft_nodes, form_id, event_type_id, template_key") // @plantilla-quitar(formularios)
      // @plantilla-sin(formularios): .select("id, name, description, categories, status, updated_at, nodes, edges, draft_nodes, event_type_id, template_key")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false }),
    supabase.from("channels").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("is_active", true),
    resolveViewerTimezone(workspace.timezone),
  ]);

  // Un flujo YA publicado al que se le desconecto algo no se despublica solo, pero se avisa que pasos no se van a
  // ejecutar (G1.6). Solo se consultan las conexiones si algun flujo publicado tiene una accion que las necesita.
  const list = flows ?? [];
  const published = list.filter((f) => f.status === "published" && Array.isArray(f.nodes) && (f.nodes as unknown as GraphNodeLike[]).some((n) => requirementsOfNode(n).length > 0));
  const capabilities = published.length > 0 ? await loadAutomationCapabilities(await createServiceClient(), workspace.id) : null;

  const rows: FlowListRow[] = list.map((f) => {
    const nodes = (Array.isArray(f.nodes) ? f.nodes : []) as Array<{ type?: string; data?: Record<string, unknown> }>;
    const trigger = nodes.find((n) => n?.type === "trigger");
    const blocked =
      capabilities && f.status === "published" ? blockedNodes(nodes as unknown as GraphNodeLike[], (Array.isArray(f.edges) ? f.edges : []) as unknown as GraphEdgeLike[], capabilities) : [];
    const missing = [...new Set(blocked.flatMap((b) => b.missing))].map((r) => REQUIREMENT_INFO[r].label).join(", ");
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      categories: normalizeCategories(f.categories ?? []),
      status: f.status as FlowStatus,
      origin: flowOrigin(f),
      triggerLabel: trigger ? triggerDisplayLabel(trigger.data ?? {}) : "Sin disparador",
      stepCount: nodes.filter((n) => n?.type !== "trigger").length,
      updatedAt: f.updated_at,
      hasDraft: f.status === "published" && Array.isArray(f.draft_nodes),
      blockedNote: blocked.length > 0 ? `${blocked.length === 1 ? "1 paso no se va a ejecutar" : `${blocked.length} pasos no se van a ejecutar`}: falta ${missing}.` : null,
    };
  });

  return (
    <FlowsList
      rows={rows}
      initialQuery={parseFlowListQuery(sp)}
      canEdit={ctx.can("flows.edit")}
      hasChannels={(channelCount ?? 0) > 0}
      timeZone={timeZone}
    />
  );
}
