import { getWorkspace } from "@/lib/workspace";
import { isAdminRole } from "@/lib/auth/roles";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { TemplatesView, type TemplateRow } from "./templates-view";

/**
 * Gestion de templates de respuesta rapida (F17).
 *
 * Entra cualquier miembro, no solo Owner/Admin: un Member los usa todos los
 * dias desde la bandeja y tiene que poder leer que dice cada uno antes de
 * mandarlo. Lo que cambia segun el rol es si ve los botones de crear y editar,
 * y eso lo decide la RLS de la 00023 aunque alguien se saltee la pantalla.
 */

export default async function TemplatesPage() {
  const { workspace, supabase, role } = await getWorkspace();

  const [templatesRes, members] = await Promise.all([
    supabase
      .from("response_templates")
      .select("id, name, content, shortcut, created_by, updated_at")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("name"),
    getWorkspaceMembers(workspace.id),
  ]);

  if (templatesRes.error) {
    console.error("[templates] listado fallido:", templatesRes.error.message);
  }

  const authorName = new Map(members.map((m) => [m.userId, m.name]));

  const templates: TemplateRow[] = (templatesRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    content: t.content,
    shortcut: t.shortcut,
    author: t.created_by ? (authorName.get(t.created_by) ?? "—") : "—",
    updatedAt: t.updated_at,
  }));

  return (
    <TemplatesView
      templates={templates}
      canManage={isAdminRole(role)}
      workspaceName={workspace.name}
    />
  );
}
