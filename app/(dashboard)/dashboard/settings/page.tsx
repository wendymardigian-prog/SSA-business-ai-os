import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { can, systemRolePermissions } from "@/lib/auth/permissions";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  // La configuracion del workspace (nombre, keywords) es de Owner/Admin.
  // Las API keys viven en /dashboard/settings/integrations.
  const { workspace, role } = await requireWorkspaceAdmin();

  // S7: el link a Corridas se gatea por ai_costs.view, no por ser admin.
  // Hoy el guard de esta pagina ya exige Owner/Admin (los dos la tienen), asi
  // que el chequeo siempre da true acá; queda hecho bien para cuando cambie.
  const canViewAiCosts = can(systemRolePermissions(role), "ai_costs.view");

  return (
    <SettingsView
      workspace={{
        id: workspace.id,
        name: workspace.name,
        globalKeywords: (workspace.global_keywords as string[]) ?? [],
        optOutPhrases: workspace.opt_out_phrases ?? [],
        leadScopeEnabled: Boolean(workspace.lead_scope_enabled),
        unassignedVisibleToMembers: Boolean(
          workspace.unassigned_leads_visible_to_members,
        ),
        persistChatMedia: workspace.persist_chat_media ?? true,
        chatMediaRetentionDays: workspace.chat_media_retention_days ?? 180,
        timezone: (workspace as { timezone?: string }).timezone ?? "UTC",
      }}
      canViewAiCosts={canViewAiCosts}
    />
  );
}
