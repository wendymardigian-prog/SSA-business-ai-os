import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  // La configuracion del workspace (API keys, keywords) es de Owner/Admin.
  const { workspace } = await requireWorkspaceAdmin();

  return (
    <SettingsView
      workspace={{
        id: workspace.id,
        name: workspace.name,
        hasApiKey: !!workspace.late_api_key_encrypted,
        hasAiKey: !!workspace.ai_api_key,
        globalKeywords: (workspace.global_keywords as string[]) ?? [],
      }}
    />
  );
}
