/**
 * Los tres triggers de Formularios en el registro (F19): `form_submitted`,
 * `survey_answered` y `contract_signed`.
 *
 * Acá solo se declaran: qué evento atiende cada uno, cómo se filtra y cuál es su
 * clave de idempotencia. Las reglas viven en `lib/forms/automation/triggers.ts`,
 * puras y con sus tests. Sumar un tipo es declararlo con sus `eventTypes`: el
 * cron `automation-events` no se toca.
 *
 * El payload del evento trae SOLO escalares (`submission_id`, `form_id`, ...): las
 * respuestas se leen acá, de la base, para filtrar y para armar las variables.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerTrigger } from "./registry";
import { appUrl } from "@/lib/app-url";
import {
  FORM_TRIGGER_LABELS,
  FORM_TRIGGER_TYPES,
  answersForConditions,
  formDedupeKey,
  formEventMatches,
  type SubmissionForMatch,
} from "@/lib/forms/automation/triggers";
import { formVariables } from "@/lib/forms/automation/variables";
import { formVariableSchema } from "@/lib/forms/automation/variable-schema";
import type { FormWithFields } from "@/lib/forms/automation/trigger-config";
import type { FormField } from "@/lib/forms/fields";

type Db = SupabaseClient<Database>;

interface LoadedSubmission {
  match: SubmissionForMatch;
  row: {
    id: string;
    created_at: string;
    answers: Record<string, { value?: unknown } | undefined>;
    score: number | null;
    nps_category: string | null;
    contact_created: boolean;
  };
  form: { id: string; name: string; type: string; slug: string; category: string | null };
}

/** La respuesta y su formulario. `null` si ya no existe (el evento queda sin disparar, no falla). */
async function loadSubmission(db: Db, submissionId: string): Promise<LoadedSubmission | null> {
  if (!submissionId) return null;
  const { data: row } = await db
    .from("form_submissions")
    .select("id, form_id, answers, score, nps_category, contact_created, created_at")
    .eq("id", submissionId)
    .maybeSingle();
  if (!row) return null;
  const { data: form } = await db.from("forms").select("id, name, type, slug, survey_config").eq("id", row.form_id).maybeSingle();
  if (!form) return null;
  const category = (form.survey_config as { category?: string } | null)?.category ?? null;
  const answers = (row.answers ?? {}) as Record<string, { value?: unknown } | undefined>;
  return {
    match: {
      formId: row.form_id,
      score: row.score,
      npsCategory: row.nps_category,
      surveyCategory: category,
      answers: answersForConditions(answers),
    },
    row: { id: row.id, created_at: row.created_at, answers, score: row.score, nps_category: row.nps_category, contact_created: row.contact_created },
    form: { id: form.id, name: form.name, type: form.type, slug: form.slug, category },
  };
}

function fieldsOfDefinition(definition: unknown): FormField[] {
  const fields = (definition as { fields?: unknown } | null)?.fields;
  return Array.isArray(fields) ? (fields as FormField[]) : [];
}

/**
 * Los formularios del disparador con los campos de su version PUBLICADA: es con
 * la que se responde, y por eso con la que se arman las condiciones. Un
 * formulario que todavia no se publico (la automatizacion se arma antes) usa
 * su borrador, y la condicion se vuelve a mirar cuando se publique.
 */
async function loadFormsWithFields(db: Db, workspaceId: string, formIds: string[]): Promise<FormWithFields[]> {
  if (formIds.length === 0) return [];
  const { data: forms } = await db
    .from("forms")
    .select("id, current_version_id, draft_definition")
    .eq("workspace_id", workspaceId)
    .in("id", formIds);
  if (!forms || forms.length === 0) return [];

  const versionIds = forms.map((f) => f.current_version_id).filter((id): id is string => !!id);
  const definitions = new Map<string, unknown>();
  if (versionIds.length > 0) {
    const { data: versions } = await db.from("form_versions").select("id, definition").in("id", versionIds);
    for (const version of versions ?? []) definitions.set(version.id, version.definition);
  }

  return forms.map((form) => ({
    id: form.id,
    fields: fieldsOfDefinition(form.current_version_id && definitions.has(form.current_version_id) ? definitions.get(form.current_version_id) : form.draft_definition),
  }));
}

for (const type of FORM_TRIGGER_TYPES) {
  registerTrigger({
    type,
    label: FORM_TRIGGER_LABELS[type],
    scope: "event",
    // Debajo de `crm_event` (50), igual que los de agenda y llamadas: si un evento
    // de formulario también encajara en uno del CRM, primero corre el específico.
    priority: 45,
    eventTypes: [type],

    eventMatches: async (args) => {
      const payload = args.event.payload as Record<string, unknown>;
      const loaded = await loadSubmission(args.supabase, String(payload.submission_id ?? ""));
      if (!loaded) return false;
      return formEventMatches(type, args.config ?? {}, loaded.match);
    },

    // Que se puede comparar en un camino condicional: nombre, puntaje y las preguntas.
    variableSchema: async (config, ctx) => {
      const ids = Array.isArray(config?.form_ids) ? (config.form_ids as unknown[]).filter((id): id is string => typeof id === "string") : [];
      return formVariableSchema(type, await loadFormsWithFields(ctx.supabase, ctx.workspaceId, ids));
    },

    dedupeKeyFor: (args) => {
      const payload = args.event.payload as Record<string, unknown>;
      return formDedupeKey(type, String(payload.submission_id ?? args.event.id));
    },

    variablesFor: async (args) => {
      const payload = args.event.payload as Record<string, unknown>;
      const loaded = await loadSubmission(args.supabase, String(payload.submission_id ?? ""));
      if (!loaded) return {};
      return { ...formVariables({ form: loaded.form, submission: loaded.row, baseUrl: appUrl() }) };
    },
  });
}
