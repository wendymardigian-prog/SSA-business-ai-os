import { getWorkspace } from "@/lib/workspace";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { ImportView } from "./import-view";

/**
 * Importacion de contactos desde CSV (F19).
 *
 * Pantalla propia y no un modal sobre la lista: una importacion de 10.000
 * filas dura un rato, y perderla por un clic afuera del modal seria una
 * pesima manera de descubrir que era un modal. Ademas la URL se puede
 * compartir con quien tenga que hacerla.
 */
export default async function ImportPage() {
  const { workspace, supabase } = await getWorkspace();

  const [tagsRes, members] = await Promise.all([
    supabase.from("tags").select("id, name").eq("workspace_id", workspace.id).order("name"),
    getWorkspaceMembers(workspace.id),
  ]);

  return (
    <ImportView
      tags={(tagsRes.data ?? []).map((t) => t.name)}
      members={members.map((m) => ({ userId: m.userId, label: m.name }))}
    />
  );
}
