import { notFound, redirect } from "next/navigation";
import { requirePermission, isAdminRole } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { SurveyDashboard, type SurveyComment } from "@/components/forms/survey/survey-dashboard";
import { SurveyConfigCards } from "@/components/forms/survey/survey-config";
import { EditorBar } from "@/components/forms/editor/editor-bar";
import { loadEditorBar } from "@/lib/forms/editor-bar-load";
import { parseStoredContactConfig } from "@/lib/forms/contact-config";
import { fieldsOf } from "@/lib/forms/server-ports";
import { addDays, dayInZone, resolvePeriod } from "@/lib/forms/metrics";
import { parseStoredSurveyConfig, scaleOf } from "@/lib/forms/survey";
import { distribution, evolution, granularityFor, summarizeSurvey } from "@/lib/forms/survey-metrics";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 5000;

/**
 * El panel de una encuesta (F23): respuestas, NPS o promedio, distribución, evolución
 * y los últimos comentarios. Se lee con el cliente de QUIEN MIRA: la RLS decide qué
 * respuestas ve, así que un Member ve el panel calculado solo sobre las de sus contactos
 * (y la pantalla lo aclara). El spam queda afuera.
 */
export default async function EncuestaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("forms.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, workspace } = ctx;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);

  const { data: form } = await supabase
    .from("forms")
    .select("id, name, type, status, survey_config, contact_config, current_version_id, draft_definition")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!form) notFound();
  if (form.type !== "survey") redirect(`/dashboard/formularios/${id}`);

  const timeZone = workspace.timezone || "UTC";
  const [viewerZone, barData] = await Promise.all([resolveViewerTimezone(workspace.timezone), loadEditorBar(supabase, workspace.id, id)]);
  const period = resolvePeriod({ dias: one("dias"), desde: one("desde"), hasta: one("hasta") }, dayInZone(new Date(), timeZone));

  let definition = form.draft_definition;
  if (form.current_version_id) {
    const { data: version } = await supabase.from("form_versions").select("definition").eq("id", form.current_version_id).maybeSingle();
    if (version) definition = version.definition;
  }
  const fields = fieldsOf(definition);
  const config = parseStoredSurveyConfig(form.survey_config);
  const scoreField = fields.find((f) => f.key === config?.scoreFieldKey);
  const scale = scaleOf(scoreField);
  const commentField = fields.find((f) => f.type === "long_text" && f.key !== config?.scoreFieldKey);

  // Con un día de margen a cada lado y el recorte exacto por día LOCAL en JS: así una
  // respuesta de las 23:30 de Costa Rica cae en su día y no en el siguiente de UTC.
  const { data: rows, error } = await supabase
    .from("form_submissions")
    .select("id, created_at, score, answers")
    .eq("form_id", id)
    .eq("workspace_id", workspace.id)
    .neq("status", "spam")
    .not("score", "is", null)
    .gte("created_at", `${addDays(period.from, -1)}T00:00:00Z`)
    .lte("created_at", `${addDays(period.to, 1)}T23:59:59Z`)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  const inPeriod = (rows ?? []).filter((r) => {
    const day = dayInZone(r.created_at, timeZone);
    return day >= period.from && day <= period.to;
  });
  const scores = inPeriod.map((r) => r.score as number);
  const spanDays = Math.round((Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000) + 1;
  const granularity = granularityFor(spanDays);

  const comments: SurveyComment[] = commentField
    ? inPeriod
        .map((r) => {
          const answer = ((r.answers ?? {}) as Record<string, { value?: unknown }>)[commentField.key]?.value;
          return { id: r.id, text: typeof answer === "string" ? answer.trim() : "", score: r.score as number, createdAt: r.created_at };
        })
        .filter((c) => c.text !== "")
        .slice(0, 10)
    : [];

  return (
    <SurveyDashboard
      header={barData ? <EditorBar form={barData.form} route="encuesta" canManage={ctx.can("forms.manage")} noContactsWarning={barData.noContactsWarning} /> : null}
      topSlot={
        <SurveyConfigCards
          formId={form.id}
          archived={form.status === "archived"}
          contactMode={parseStoredContactConfig(form.contact_config).mode}
          fields={fieldsOf(form.draft_definition)}
          initial={config}
          canManage={ctx.can("forms.manage")}
        />
      }
      formId={form.id}
      period={period}
      scale={scale}
      summary={summarizeSurvey(scores, scale)}
      bars={distribution(scores, scale)}
      points={evolution(inPeriod.map((r) => ({ created_at: r.created_at, score: r.score as number })), granularity, timeZone, scale)}
      granularity={granularity}
      comments={comments}
      commentLabel={commentField?.label ?? null}
      scoreLabel={scoreField?.label ?? null}
      scopedToOwnContacts={!isAdminRole(ctx.role)}
      truncated={(rows ?? []).length >= MAX_ROWS}
      loadError={!!error}
      activePreset={one("desde") && one("hasta") ? "custom" : one("dias") ?? "30"}
      timeZone={viewerZone}
    />
  );
}
