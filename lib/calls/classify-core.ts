/**
 * Lo que comparten clasificar una grabacion nueva (`classify-run.ts`) y volver a
 * clasificarla sin IA cuando cambia su reunion (`reclassify.ts`): leer el contexto y armar
 * lo que se guarda. Lee la base; las decisiones son de `classify-cascade.ts` y `catalog.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { categorySnapshot, type CategoryRow, type CategorySnapshot } from "@/lib/scheduling/categories";
import { parseFathomSettings } from "@/lib/fathom/settings";
import { NO_SHOW_TARGET, readCategorySnapshot, ruleTargetSnapshot } from "./catalog";
import { applyClassificationRules, teamNamesFrom, type MeetingForRules } from "./classification";
import { categoryIdOf, type CascadeResult, type CascadeSource } from "./classify-cascade";
import type { CallAnalysisProfile } from "./profiles";
import { loadCallProfiles } from "./profiles-load";
import { resolveCallTaskSettings, type CallTaskSettings } from "./task-settings";

type Db = SupabaseClient<Database>;

export interface ClassificationContext {
  settings: CallTaskSettings;
  categories: CategoryRow[];
  /** El area y el tipo de la reunion vinculada, si los tiene. */
  booking: CategorySnapshot | null;
  /** Lo que decidio la primera regla que se cumple, y su nombre. */
  rule: CategorySnapshot | null;
  ruleLabel: string | null;
  /** El area por defecto de la conexion de Fathom que la trajo. */
  connection: CategorySnapshot | null;
  /** Los analizadores del negocio: deciden que pasa despues de clasificar. */
  profiles: CallAnalysisProfile[];
  /** Una regla dice que nadie se presento, y su nombre. */
  noShowRule: boolean;
  noShowRuleLabel: string | null;
}

async function loadTeam(db: Db, workspaceId: string): Promise<{ emails: string[]; names: string[] }> {
  const { data, error } = await db.rpc("workspace_member_profiles", { p_workspace_id: workspaceId });
  if (error || !data) return { emails: [], names: [] };
  return {
    emails: data.map((m) => m.email ?? "").filter(Boolean),
    names: teamNamesFrom(data.map((m) => ({ full_name: m.full_name ?? m.meta_name ?? null }))),
  };
}

export async function loadClassificationContext(
  db: Db,
  call: MeetingForRules & { workspace_id: string; booking_id?: string | null; connection_id?: string | null },
): Promise<ClassificationContext> {
  const [{ data: ws }, rows, team, bookingRow, profiles, connectionRow] = await Promise.all([
    db.from("workspaces").select("ai_background_settings").eq("id", call.workspace_id).maybeSingle(),
    listCategories(db, call.workspace_id),
    loadTeam(db, call.workspace_id),
    call.booking_id
      ? db.from("bookings").select("category_snapshot").eq("id", call.booking_id).maybeSingle()
      : Promise.resolve({ data: null }),
    loadCallProfiles(db, call.workspace_id),
    call.connection_id ? db.from("oauth_connections").select("fathom_settings").eq("id", call.connection_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const settings = resolveCallTaskSettings(ws?.ai_background_settings);
  const categories = rows.map(toCategoryRow);
  const rules = settings.call_classification.rules;

  const noShowFired = applyClassificationRules(call, rules.filter((r) => r.type === NO_SHOW_TARGET), team.emails, team.names);
  const fired = applyClassificationRules(call, rules.filter((r) => r.type !== NO_SHOW_TARGET), team.emails, team.names);
  const rule = fired ? ruleTargetSnapshot(fired.target, categories, settings.call_classification.custom_types) : null;

  return {
    settings,
    categories,
    profiles,
    booking: readCategorySnapshot((bookingRow.data as { category_snapshot?: unknown } | null)?.category_snapshot),
    rule,
    ruleLabel: rule && fired ? fired.rule_label : null,
    connection: connectionAreaSnapshot(connectionRow.data?.fathom_settings, categories),
    noShowRule: !!noShowFired,
    noShowRuleLabel: noShowFired?.rule_label ?? null,
  };
}

/** El area por defecto de una conexion. Una que se archivo o que ya no es un area, no decide. */
function connectionAreaSnapshot(raw: unknown, categories: CategoryRow[]): CategorySnapshot | null {
  const areaId = parseFathomSettings(raw).default_area_id;
  if (!areaId || !categories.some((c) => c.id === areaId && c.parent_id === null && !c.archived_at)) return null;
  return categorySnapshot(areaId, categories);
}

/** Lo que se guarda de una clasificacion automatica. */
export function classificationPatch(
  result: CascadeResult,
  ctx: Pick<ClassificationContext, "categories" | "ruleLabel" | "noShowRuleLabel">,
  noShow: boolean,
  ai: { confidence: number } | null = null,
) {
  const { snapshot, source } = result;
  return {
    area_id: snapshot?.area_id ?? null,
    category_id: categoryIdOf(snapshot),
    category_snapshot: (snapshot ?? null) as unknown as Json,
    classification_source: source,
    no_show: noShow,
    classification_rule: source === "rule" ? ctx.ruleLabel : !source && noShow ? ctx.noShowRuleLabel : null,
    classification_confidence: ai?.confidence ?? null,
  };
}
