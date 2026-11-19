import { getPermissionContext } from "@/lib/auth/guards";
import { loadAssistantPanel } from "@/lib/actions/assistant";
import { AssistantFullScreen } from "@/components/assistant/assistant-full";
import { ROLE_LABELS, type WorkspaceRole } from "@/lib/auth/roles";

/**
 * El asistente a pantalla completa. Se llega desde el botón de pantalla
 * completa del panel acoplado. Sin «Usar el asistente» no se lee nada: se dice por qué.
 */
export const dynamic = "force-dynamic";

export default async function AsistentePage() {
  const ctx = await getPermissionContext();
  if (!ctx.can("assistant.use")) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-md rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-100">Tu rol no tiene el permiso «Usar el asistente». Pedíselo a un Owner o Admin.</p>
      </div>
    );
  }
  const initial = await loadAssistantPanel();
  // «Actúa con tu rol: …»: el nombre del rol asignado o el del rol de sistema.
  let roleName: string = ROLE_LABELS[ctx.role as WorkspaceRole] ?? ctx.role;
  if (ctx.roleId) {
    const { data } = await ctx.supabase.from("workspace_roles").select("name").eq("id", ctx.roleId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (data?.name) roleName = data.name as string;
  }
  return <AssistantFullScreen initial={initial} roleName={roleName} />;
}
