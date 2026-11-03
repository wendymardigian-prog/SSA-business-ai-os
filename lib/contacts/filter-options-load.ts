/**
 * Las opciones de TODOS los filtros de la lista de Contactos, armadas igual que
 * la pantalla de Contactos (`coreFilterOptions` + las de cada área). La usa la
 * audiencia de un broadcast, que ofrece exactamente los mismos filtros.
 * Con el cliente del usuario: la RLS decide qué ve.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import { platformLabel } from "@/lib/platforms";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { coreFilterOptions } from "./filters/options";
import { loadCustomFieldRefs, loadModuleFilterOptions } from "./list-load";
import { loadContactStatusSettings } from "./status-settings-load";
import { loadInterestCatalog } from "./interest-load";
import type { CustomFieldRef } from "./list-filters";

export async function loadContactFilterOptions(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<{ options: Record<string, MultiFilterOption[]>; customFields: CustomFieldRef[]; hasAnonymous: boolean }> {
  const [customFields, statusSettings, interestCatalog, tagsRes, channelsRes, members, moduleOptions, anonymousRes] = await Promise.all([
    loadCustomFieldRefs(supabase, workspaceId),
    loadContactStatusSettings(workspaceId),
    loadInterestCatalog(supabase, workspaceId),
    supabase.from("tags").select("id, name, color").eq("workspace_id", workspaceId).order("name"),
    supabase.from("channels").select("platform").eq("workspace_id", workspaceId).eq("is_active", true),
    getWorkspaceMembers(workspaceId),
    loadModuleFilterOptions(supabase, workspaceId),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("deleted_at", null).eq("is_anonymous", true),
  ]);
  const platforms = [...new Set((channelsRes.data ?? []).map((c) => c.platform))].sort();
  return {
    options: {
      ...coreFilterOptions({
        members: members.map((m) => ({ userId: m.userId, label: m.name })),
        tags: tagsRes.data ?? [],
        platforms: platforms.map((p) => ({ value: p, label: platformLabel(p) })),
        statusSettings,
        interestCatalog,
      }),
      ...moduleOptions,
    },
    customFields,
    hasAnonymous: (anonymousRes.count ?? 0) > 0,
  };
}
