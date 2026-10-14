import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { BroadcastsView } from "./broadcasts-view";

export default async function BroadcastsPage() {
  // Equipo y roles (F22): la pagina pide su permiso.
  await requirePermission("broadcasts.manage");
  const { workspace, supabase } = await getWorkspace();

  const { data: broadcasts } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <BroadcastsView
      broadcasts={broadcasts ?? []}
      workspaceId={workspace.id}
    />
  );
}
