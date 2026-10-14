import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { TemplatesView } from "./templates-view";

export default async function TemplatesPage() {
  // Equipo y roles (F22): la pagina pide su permiso.
  await requirePermission("flows.view");
  const { workspace } = await getWorkspace();

  return <TemplatesView workspaceId={workspace.id} />;
}
