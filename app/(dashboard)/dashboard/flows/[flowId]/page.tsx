import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { notFound } from "next/navigation";
import { FlowCanvas } from "@/components/flow-builder/flow-canvas";

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

  return (
    <div className="flex h-full flex-col">
      <FlowCanvas flow={flow} />
    </div>
  );
}
