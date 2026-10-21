import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
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
  // Equipo y roles (F21): la pagina pide su permiso; el alcance de los contactos lo sigue aplicando la RLS.
  await requirePermission("contacts.import");
  const { workspace, supabase } = await getWorkspace();

  const [tagsRes, members, fieldsRes] = await Promise.all([
    supabase.from("tags").select("id, name").eq("workspace_id", workspace.id).order("name"),
    getWorkspaceMembers(workspace.id),
    supabase
      .from("custom_field_definitions")
      .select("id, name, type")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("name"),
  ]);

  return (
    <ImportView
      tags={(tagsRes.data ?? []).map((t) => t.name)}
      members={members.map((m) => ({ userId: m.userId, label: m.name }))}
      customFields={fieldsRes.data ?? []}
    />
  );
}
