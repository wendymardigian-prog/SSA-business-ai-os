import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { notFound } from "next/navigation";
import { FlowCanvas } from "@/components/flow-builder/flow-canvas";
import { parseAttributionSettings } from "@/lib/attribution/settings";
import { createServiceClient } from "@/lib/supabase/server";
import { loadAutomationCapabilities } from "@/lib/flow-engine/capabilities";
import { isModuleEnabled } from "@/lib/services/module"; // @plantilla-quitar(servicios)
import Link from "next/link"; // @plantilla-quitar(servicios)
import { ArrowLeft } from "lucide-react"; // @plantilla-quitar(servicios)
import { backToPathHref } from "@/lib/services/screens/back-to-path"; // @plantilla-quitar(servicios)

export default async function FlowEditorPage({
  params,
  searchParams, // @plantilla-quitar(servicios)
}: {
  params: Promise<{ flowId: string }>;
  searchParams: Promise<{ volver?: string }>; // @plantilla-quitar(servicios)
}) {
  const { flowId } = await params;
  const backTo = backToPathHref((await searchParams).volver); // @plantilla-quitar(servicios)
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

  // Las conexiones del negocio hoy (G1): las acciones que dependen de una que falta se ven bloqueadas. Se calculan aca,
  // al abrir: al conectar un proveedor y volver, las acciones quedan habilitadas sin tocar el flujo.
  const capabilities = await loadAutomationCapabilities(await createServiceClient(), workspace.id);

  return (
    <div className="flex h-full flex-col">
      {/* @plantilla-desde(servicios) */}
      {backTo && (
        <Link href={backTo} className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-4 py-2 text-sm text-primary-ink hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver al camino
        </Link>
      )}
      {/* @plantilla-hasta(servicios) */}
      <FlowCanvas
        flow={flow}
        capabilities={capabilities}
        servicesEnabled={isModuleEnabled(workspace as { services_enabled?: boolean | null })} // @plantilla-quitar(servicios)
        attributionDefaults={{ append: attribution.links_append_default, trackClicks: attribution.links_track_clicks_default }}
      />
    </div>
  );
}
