import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  // La configuracion del workspace (nombre, keywords) es de Owner/Admin.
  // Las API keys viven en /dashboard/settings/integrations.
  const { workspace } = await requireWorkspaceAdmin();

  return (
    <SettingsView
      workspace={{
        id: workspace.id,
        name: workspace.name,
        globalKeywords: (workspace.global_keywords as string[]) ?? [],
      }}
    />
  );
}
