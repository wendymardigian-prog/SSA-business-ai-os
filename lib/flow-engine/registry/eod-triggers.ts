/**
 * "Se envió un reporte de fin de día" en el registro (E16): `eod_submitted`.
 *
 * Es el primer disparador SIN contacto (`subject: "member"`): el flujo es sobre la persona
 * del equipo que envió el reporte. El cron `automation-events` lo arranca con
 * `contactId: null` y `memberUserId`, sin buscar conversación ni aplicar "no contactar".
 * Los pasos que necesitan un contacto no se pueden agregar a estos flujos (y si llegaran,
 * el motor los saltea).
 *
 * Las reglas viven puras en `lib/eod/automation/` (con sus tests); acá solo se declaran.
 * El payload del evento trae SOLO escalares (report_id, form_id, report_date, edit_count):
 * el reporte se lee acá, de la base.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerTrigger } from "./registry";
import { appUrl } from "@/lib/app-url";
import { memberDisplayName } from "@/lib/workspace-members";
import { parseStoredEodConfig } from "@/lib/eod/config";
import { eodParts } from "@/lib/eod/definition";
import type { EodMetrics } from "@/lib/eod/metrics";
import type { FormDefinition } from "@/lib/forms/fields";
import type { LabeledAnswer } from "@/lib/forms/submission-schema";
import { eodVariables, eodVariableSchema, type EodFormForSchema } from "@/lib/eod/automation/variables";
import { EOD_TRIGGER } from "@/lib/eod/automation/trigger-name";
import { eodDedupeKey, eodEventMatches, parseEodPayload, parseEodTriggerConfig } from "@/lib/eod/automation/trigger-config";

type Db = SupabaseClient<Database>;

export const EOD_TRIGGER_TYPE = EOD_TRIGGER;

/** Los EOD del disparador con su versión PUBLICADA (o el borrador si nunca se publicó). */
export async function loadEodFormsForSchema(db: Db, workspaceId: string, formIds: string[]): Promise<EodFormForSchema[]> {
  if (formIds.length === 0) return [];
  const { data: forms } = await db.from("forms").select("id, type, current_version_id, draft_definition").eq("workspace_id", workspaceId).eq("type", "eod").in("id", formIds);
  if (!forms || forms.length === 0) return [];
  const versionIds = forms.map((f) => f.current_version_id).filter((id): id is string => !!id);
  const definitions = new Map<string, unknown>();
  if (versionIds.length > 0) {
    const { data: versions } = await db.from("form_versions").select("id, definition").in("id", versionIds);
    for (const v of versions ?? []) definitions.set(v.id, v.definition);
  }
  return forms.map((form) => {
    const def = (form.current_version_id && definitions.get(form.current_version_id)) || form.draft_definition;
    const parts = eodParts(def as Partial<FormDefinition>);
    return { id: form.id, fields: parts.fields, channels: parts.channels };
  });
}

registerTrigger({
  type: EOD_TRIGGER_TYPE,
  label: "Se envió un reporte de fin de día",
  scope: "event",
  priority: 45,
  subject: "member",
  sourceType: "member",
  eventTypes: [EOD_TRIGGER_TYPE],

  eventMatches: (args) => eodEventMatches(args.config, args.event.payload),

  dedupeKeyFor: (args) => eodDedupeKey(args.event.payload, args.event.id),

  auditEntityFor: (args) => {
    const payload = parseEodPayload(args.event.payload);
    return payload ? { entityType: "eod_report", entityId: payload.report_id, metadata: { form_id: payload.form_id } } : null;
  },

  variableSchema: async (config, ctx) => eodVariableSchema(await loadEodFormsForSchema(ctx.supabase, ctx.workspaceId, parseEodTriggerConfig(config).form_ids)),

  variablesFor: async (args) => {
    const payload = parseEodPayload(args.event.payload);
    if (!payload) return {};
    const db = args.supabase;
    const [{ data: report }, { data: form }, { data: profiles }] = await Promise.all([
      db.from("eod_reports").select("id, user_id, report_date, edit_count, answers, channels, metrics").eq("id", payload.report_id).maybeSingle(),
      db.from("forms").select("id, name, eod_config").eq("id", payload.form_id).maybeSingle(),
      db.rpc("workspace_member_profiles", { p_workspace_id: args.event.workspace_id }),
    ]);
    if (!report || !form) return {};
    const profile = (profiles ?? []).find((p) => p.user_id === report.user_id);
    return eodVariables({
      form: { id: form.id, name: form.name, roleLabel: parseStoredEodConfig(form.eod_config)?.roleLabel ?? "" },
      report: {
        id: report.id,
        reportDate: report.report_date,
        editCount: report.edit_count,
        answers: (report.answers ?? {}) as unknown as Record<string, LabeledAnswer>,
        channels: (report.channels ?? {}) as unknown as Record<string, { label: string; answers: Record<string, LabeledAnswer> }>,
        metrics: (report.metrics ?? {}) as unknown as EodMetrics,
      },
      member: { name: profile ? memberDisplayName(profile.full_name, profile.meta_name, profile.email) : "", email: profile?.email ?? "" },
      baseUrl: appUrl(),
    });
  },
});
