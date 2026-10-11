/**
 * Lo que la pestaña Configuracion de Clasificacion y Analisis de llamadas
 * necesita (F19). Lee la configuracion guardada, las propuestas de la IA, las
 * llamadas que se pueden usar para probar y el historial de la rubrica (que es
 * el `audit_log`: no hay tabla de versiones de rubrica).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { loadCategoryProposals } from "./category-inbox";
import type { CategoryProposal } from "./categories";
import { normalizeRubric, type Rubric } from "./rubric";
import { resolveCallTaskSettings, validTypeKeys, type CallAnalysisSettings, type CallClassificationSettings, type CallTaskKey } from "./task-settings";
import { loadTypeProposals, type TypeProposal } from "./type-proposals";

type Db = SupabaseClient<Database>;

export interface TestableCall {
  id: string;
  title: string;
  recordedAt: string;
  closerScore: number | null;
}

export interface RubricVersion {
  /** `audit_log.id`: identifica la version en el historial. */
  id: string;
  at: string;
  version: number;
  rubric: Rubric;
}

export type CallConfigData =
  | { task: "call_classification"; canEdit: boolean; settings: CallClassificationSettings; typeProposals: TypeProposal[] }
  | {
      task: "call_analysis";
      canEdit: boolean;
      settings: CallAnalysisSettings;
      /** Todavia no se guardo una rubrica: se usa la generica de arranque, y la pantalla lo dice. */
      usingDefaultRubric: boolean;
      validTypes: string[];
      categoryProposals: CategoryProposal[];
      testableCalls: TestableCall[];
      rubricHistory: RubricVersion[];
    };

interface AuditRow {
  id: string;
  created_at: string;
  changes: unknown;
}

/** Las rubricas que quedaron en el historial, de la mas nueva a la mas vieja. Descarta lo que no tiene una rubrica legible. */
export function parseRubricHistory(rows: AuditRow[]): RubricVersion[] {
  const out: RubricVersion[] = [];
  for (const row of rows) {
    const changes = row.changes as Record<string, { new?: { rubric?: unknown } | null }> | null;
    const saved = changes?.["ai_background_settings.call_analysis"]?.new;
    if (!saved || typeof saved !== "object" || !saved.rubric) continue;
    const rubric = normalizeRubric(saved.rubric);
    out.push({ id: row.id, at: row.created_at, version: rubric.version, rubric });
  }
  return out;
}

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
  if (args.task === "call_classification") {
    return {
      task: "call_classification",
      canEdit: args.canEdit,
      settings: settings.call_classification,
      typeProposals: args.canEdit ? await loadTypeProposals(args.service, args.workspaceId, settings.call_classification) : [],
    };
  }

  const analysis = settings.call_analysis;
  const stored = args.stored && typeof args.stored === "object" ? (args.stored as Record<string, unknown>) : {};
  const storedAnalysis = stored.call_analysis && typeof stored.call_analysis === "object" ? (stored.call_analysis as Record<string, unknown>) : null;

  const [proposals, calls, history] = await Promise.all([
    args.canEdit ? loadCategoryProposals(args.service, args.workspaceId, analysis.categories) : Promise.resolve([]),
    args.userClient
      .from("calls")
      .select("id, title, recorded_at, closer_score")
      .eq("workspace_id", args.workspaceId)
      .eq("analysis_status", "analyzed")
      .is("archived_at", null)
      .order("recorded_at", { ascending: false })
      .limit(10),
    args.canEdit
      ? args.service
          .from("audit_log")
          .select("id, created_at, changes")
          .eq("workspace_id", args.workspaceId)
          .eq("entity_type", "workspace")
          .eq("action", "update")
          .contains("metadata", { task: "call_analysis" })
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as AuditRow[] }),
  ]);

  return {
    task: "call_analysis",
    canEdit: args.canEdit,
    settings: analysis,
    usingDefaultRubric: !storedAnalysis?.rubric,
    validTypes: validTypeKeys(settings.call_classification.custom_types),
    categoryProposals: proposals,
    testableCalls: (calls.data ?? []).map((c) => ({ id: c.id, title: c.title, recordedAt: c.recorded_at, closerScore: c.closer_score })),
    rubricHistory: parseRubricHistory((history.data ?? []) as AuditRow[]),
  };
}
