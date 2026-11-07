/**
 * Lo que comparten clasificar una grabacion nueva (`classify-run.ts`) y volver a
 * clasificarla sin IA cuando cambia su reunion (`reclassify.ts`): leer el contexto y armar
 * lo que se guarda. Lee la base; las decisiones son de `classify-cascade.ts` y `catalog.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import type { CategoryRow, CategorySnapshot } from "@/lib/scheduling/categories";
import { BOOKING_RULE_LABEL, NO_SHOW_TARGET, legacyCallTypeFor, readCategorySnapshot, ruleTargetSnapshot } from "./catalog";
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
  call: MeetingForRules & { workspace_id: string; booking_id?: string | null },
): Promise<ClassificationContext> {
  const [{ data: ws }, rows, team, bookingRow, profiles] = await Promise.all([
    db.from("workspaces").select("ai_background_settings").eq("id", call.workspace_id).maybeSingle(),
    listCategories(db, call.workspace_id),
    loadTeam(db, call.workspace_id),
    call.booking_id
      ? db.from("bookings").select("category_snapshot").eq("id", call.booking_id).maybeSingle()
      : Promise.resolve({ data: null }),
    loadCallProfiles(db, call.workspace_id),
  ]);
  const settings = resolveCallTaskSettings(ws?.ai_background_settings);
  const categories = rows.map(toCategoryRow);
  const rules = settings.call_classification.rules;

  const noShowFired = applyClassificationRules(call, rules.filter((r) => r.type === NO_SHOW_TARGET), team.emails, team.names);
  const fired = applyClassificationRules(call, rules.filter((r) => r.type !== NO_SHOW_TARGET), team.emails, team.names);
  const rule = fired ? ruleTargetSnapshot(fired.call_type, categories, settings.call_classification.custom_types) : null;

  return {
    settings,
    categories,
    profiles,
    booking: readCategorySnapshot((bookingRow.data as { category_snapshot?: unknown } | null)?.category_snapshot),
    rule,
    ruleLabel: rule && fired ? fired.rule_label : null,
    noShowRule: !!noShowFired,
    noShowRuleLabel: noShowFired?.rule_label ?? null,
  };
}

/** La columna vieja de "quien decidio" solo admite rule, ai y human. */
const LEGACY_SOURCE: Record<CascadeSource, "rule" | "ai"> = { booking: "rule", rule: "rule", connection: "rule", ai: "ai" };

/** Lo que se guarda de una clasificacion automatica, con `call_type` derivado. */
export function classificationPatch(
  result: CascadeResult,
  ctx: Pick<ClassificationContext, "categories" | "ruleLabel" | "noShowRuleLabel">,
  noShow: boolean,
  ai: { confidence: number; alternative: string | null } | null = null,
) {
  const { snapshot, source } = result;
  return {
    area_id: snapshot?.area_id ?? null,
    category_id: categoryIdOf(snapshot),
    category_snapshot: (snapshot ?? null) as unknown as Json,
    classification_source: source,
    no_show: noShow,
    call_type: legacyCallTypeFor(snapshot, ctx.categories, noShow),
    call_type_source: source ? LEGACY_SOURCE[source] : noShow ? ("rule" as const) : null,
    call_type_rule: source === "booking" ? BOOKING_RULE_LABEL : source === "rule" ? ctx.ruleLabel : !source && noShow ? ctx.noShowRuleLabel : null,
    call_type_confidence: ai?.confidence ?? null,
    call_type_alternative: ai?.alternative ?? null,
    call_type_proposed: null,
  };
}
