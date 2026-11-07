/**
 * Lo que la pestaña Configuracion de Clasificacion y Analisis de llamadas necesita (F19).
 * Lee la configuracion guardada, las propuestas de la IA, los analizadores por tipo con sus
 * instrucciones, y las grabaciones que se pueden usar para probar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CALL_ANALYSIS_GENERAL_DEFAULT_INSTRUCTIONS } from "@/lib/ai-tasks/instructions";
import { loadTaskInstructions, type TaskPromptVersion } from "@/lib/ai-tasks/store";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { loadCategoryProposals } from "./category-inbox";
import type { CategoryProposal } from "./categories";
import { categoryGroups, legacyRuleTargets, type CategoryGroup } from "./catalog";
import type { DefaultInstructions } from "./profile-form";
import type { CallAnalysisProfile } from "./profiles";
import { loadCallProfiles } from "./profiles-load";
import { resolveCallTaskSettings, type CallAnalysisSettings, type CallClassificationSettings, type CallTaskKey } from "./task-settings";

type Db = SupabaseClient<Database>;

export interface TestableCall {
  id: string;
  title: string;
  recordedAt: string;
  closerScore: number | null;
  categoryId: string | null;
  areaId: string | null;
}

export type CallConfigData =
  | { task: "call_classification"; canEdit: boolean; settings: CallClassificationSettings; categoryGroups: CategoryGroup[]; legacyRuleTargets: Record<string, string> }
  | {
      task: "call_analysis";
      canEdit: boolean;
      settings: CallAnalysisSettings;
      categoryGroups: CategoryGroup[];
      /** Las areas y los tipos de Ventas: su analizador arranca en el formato de ventas. */
      salesCategoryIds: string[];
      profiles: CallAnalysisProfile[];
      /** El historial de instrucciones de cada analizador, de la version mas nueva a la mas vieja. */
      profileVersions: Record<string, TaskPromptVersion[]>;
      defaultInstructions: DefaultInstructions;
      categoryProposals: CategoryProposal[];
      testableCalls: TestableCall[];
    };

/** Grabaciones que se ofrecen para probar. No hace falta que ya esten analizadas. */
const TESTABLE_CALLS = 50;

export async function loadCallConfig(args: {
  service: Db;
  /** El cliente de la persona: la RLS decide que llamadas puede usar para probar. */
  userClient: Db;
  workspaceId: string;
  task: CallTaskKey;
  canEdit: boolean;
  stored: unknown;
}): Promise<CallConfigData> {
  const settings = resolveCallTaskSettings(args.stored);
  const categories = (await listCategories(args.service, args.workspaceId)).map(toCategoryRow);
  if (args.task === "call_classification") {
    return {
      task: "call_classification",
      canEdit: args.canEdit,
      settings: settings.call_classification,
      categoryGroups: categoryGroups(categories),
      legacyRuleTargets: legacyRuleTargets(categories, settings.call_classification.custom_types),
    };
  }

  const analysis = settings.call_analysis;
  const [proposals, calls, profiles, versions, salesDefault] = await Promise.all([
    args.canEdit ? loadCategoryProposals(args.service, args.workspaceId, analysis.categories) : Promise.resolve([]),
    args.userClient
      .from("calls")
      .select("id, title, recorded_at, closer_score, category_id, area_id")
      .eq("workspace_id", args.workspaceId)
      .not("transcript", "is", null)
      .is("archived_at", null)
      .order("recorded_at", { ascending: false })
      .limit(TESTABLE_CALLS),
    loadCallProfiles(args.service, args.workspaceId),
    args.service
      .from("ai_task_prompt_versions")
      .select("variant, version, instructions, note, created_at")
      .eq("workspace_id", args.workspaceId)
      .eq("task", "call_analysis")
      .not("variant", "is", null)
      .order("version", { ascending: false }),
    loadTaskInstructions(args.service, args.workspaceId, "call_analysis"),
  ]);

  const profileVersions: Record<string, TaskPromptVersion[]> = {};
  for (const v of versions.data ?? []) {
    if (!v.variant) continue;
    (profileVersions[v.variant] ??= []).push({ version: v.version, instructions: v.instructions, note: v.note, createdAt: v.created_at, authorLabel: null });
  }

  const salesCategoryIds = categories.filter((c) => c.system_key === "ventas" || c.system_key?.startsWith("ventas.")).map((c) => c.id);

  return {
    task: "call_analysis",
    canEdit: args.canEdit,
    settings: analysis,
    categoryGroups: categoryGroups(categories),
    salesCategoryIds,
    profiles,
    profileVersions,
    defaultInstructions: { sales: salesDefault.text, general: CALL_ANALYSIS_GENERAL_DEFAULT_INSTRUCTIONS },
    categoryProposals: proposals,
    testableCalls: (calls.data ?? []).map((c) => ({ id: c.id, title: c.title, recordedAt: c.recorded_at, closerScore: c.closer_score, categoryId: c.category_id, areaId: c.area_id })),
  };
}
