import { requirePermission } from "@/lib/auth/guards";
import { ChannelsView } from "./channels-view";

export default async function ChannelsPage() {
  // Conectar y desconectar canales es de Owner/Admin.
  const { workspace, supabase } = await requirePermission("channels.manage");

  const { data: channels } = await supabase
    .from("channels")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <ChannelsView
      channels={channels ?? []}
      workspaceId={workspace.id}
    />
  );
}
