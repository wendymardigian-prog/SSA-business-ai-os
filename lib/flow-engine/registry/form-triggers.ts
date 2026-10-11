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
