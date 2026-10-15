import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { notFound } from "next/navigation";
import { FlowCanvas } from "@/components/flow-builder/flow-canvas";
import { parseAttributionSettings } from "@/lib/attribution/settings";

export default async function FlowEditorPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  // Equipo y roles (F22): la pagina pide su permiso.
  await requirePermission("flows.view");
  const { workspace, supabase } = await getWorkspace();

  const { data: flow } = await supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!flow) {
    notFound();
  }

  // Los valores por defecto de atribución del negocio (F39): el bloque «Atribución de links» del nodo de envío los usa.
  const attribution = parseAttributionSettings(workspace.attribution_settings);

  return (
    <div className="flex h-full flex-col">
      <FlowCanvas
        flow={flow}
        attributionDefaults={{ append: attribution.links_append_default, trackClicks: attribution.links_track_clicks_default }}
      />
    </div>
  );
}
