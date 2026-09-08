import { getWorkspace } from "@/lib/workspace";
import { InboxView } from "./inbox-view";

export default async function InboxPage() {
  const { workspace, supabase } = await getWorkspace();

  const [conversationsRes, templatesRes] = await Promise.all([
    supabase
      .from("conversations")
      .select("*, contacts(*)")
      .eq("workspace_id", workspace.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50),
    // Las respuestas rapidas del selector "/" (F17). Vienen desde el servidor
    // para que el selector abra sin esperar una consulta.
    supabase
      .from("response_templates")
      .select("id, name, content, shortcut")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("name"),
  ]);

  return (
    <InboxView
      conversations={conversationsRes.data ?? []}
      workspaceId={workspace.id}
      templates={templatesRes.data ?? []}
      workspaceName={workspace.name}
    />
  );
}
