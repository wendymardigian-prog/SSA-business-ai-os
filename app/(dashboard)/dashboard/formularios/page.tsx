import { requirePermission } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { FormsList } from "@/components/forms/list/forms-list";
import { formListRow, parseListQuery, type FormStats } from "@/lib/forms/list";
import { addDays, dayInZone, summarize, type DailyRow } from "@/lib/forms/metrics";
import type { FormStatus, FormType } from "@/lib/forms/fields";

export const dynamic = "force-dynamic";

/** Para medir la conversion se pide `form_metrics_daily` de cada formulario con respuestas: un tope razonable. */
const MAX_FORMS_WITH_VIEWS = 40;
/** `form_metrics_daily` no admite mas de 366 dias: la conversion de la tarjeta es la de ese ultimo anio. */
const METRICS_DAYS = 366;

/**
 * Lista de formularios (F3, plano formularios-ui F5 y F6). Lee con el cliente de la persona: la RLS decide
 * que ve. Los envios y el ultimo envio se cuentan sobre las respuestas que esa persona puede ver (un Member ve
 * las de sus contactos).
 *
 * Lo que dice cada tarjeta sale de calculos que la app ya hacia: la conversion es la de Metricas (envios sobre
 * vistas), el NPS o el promedio, los del panel de la encuesta, y de un reporte de fin de dia, los reportes
 * enviados y las personas distintas. Un dato que no se pudo medir queda en blanco, nunca en 0.
 */
export default async function FormulariosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("forms.view");
  const { supabase, workspace } = ctx;
  const sp = await searchParams;
  const initialQuery = parseListQuery({ q: sp.q, estado: sp.estado, tipo: sp.tipo });
  const timeZone = await resolveViewerTimezone(workspace.timezone);

  const { data: forms, error } = await supabase
    .from("forms")
    .select("id, name, type, status, slug, updated_at, created_at, design, draft_definition, survey_config")
    .eq("workspace_id", workspace.id)
    .order("updated_at", { ascending: false });

  // Un tope razonable: la lista no necesita contar millones de filas, solo dar una idea.
  const { data: submissions } = await supabase
    .from("form_submissions")
    .select("form_id, created_at, score")
    .eq("workspace_id", workspace.id)
    .neq("status", "spam")
    .order("created_at", { ascending: false })
    .limit(10000);

  const stats = new Map<string, FormStats & { scores: number[] }>();
  for (const s of submissions ?? []) {
    const current = stats.get(s.form_id) ?? { submissions: 0, lastSubmissionAt: null, scores: [] };
    current.submissions += 1;
    current.lastSubmissionAt ??= s.created_at; // viene de la mas nueva a la mas vieja
    if (typeof s.score === "number") current.scores.push(s.score);
    stats.set(s.form_id, current);
  }

  // Un reporte de fin de dia no son `form_submissions`: son `eod_reports` enviados (la RLS decide cuales ve cada quien).
  const eodIds = (forms ?? []).filter((f) => f.type === "eod").map((f) => f.id);
  if (eodIds.length > 0) {
    const { data: reports } = await supabase
      .from("eod_reports")
      .select("form_id, user_id, submitted_at")
      .eq("workspace_id", workspace.id)
      .eq("status", "submitted")
      .in("form_id", eodIds)
      .order("submitted_at", { ascending: false })
      .limit(10000);
    const people = new Map<string, Set<string>>();
    for (const r of reports ?? []) {
      const current = stats.get(r.form_id) ?? { submissions: 0, lastSubmissionAt: null, scores: [] };
      current.submissions += 1;
      current.lastSubmissionAt ??= r.submitted_at;
      stats.set(r.form_id, current);
      (people.get(r.form_id) ?? people.set(r.form_id, new Set()).get(r.form_id)!).add(r.user_id);
    }
    for (const [formId, set] of people) {
      const current = stats.get(formId);
      if (current) current.people = set.size;
    }
  }

  // La conversion: vistas de cada formulario con respuestas (personalizados y contratos), con la misma RPC que Metricas.
  const today = dayInZone(new Date(), workspace.timezone || "UTC");
  const needViews = (forms ?? []).filter((f) => (f.type === "custom" || f.type === "contract") && (stats.get(f.id)?.submissions ?? 0) > 0).slice(0, MAX_FORMS_WITH_VIEWS);
  await Promise.all(
    needViews.map(async (f) => {
      const earliest = addDays(today, -(METRICS_DAYS - 1));
      const created = dayInZone(f.created_at, workspace.timezone || "UTC");
      const from = created > earliest ? created : earliest;
      const { data, error: rpcError } = await supabase.rpc("form_metrics_daily", { p_form_id: f.id, p_from: from, p_to: today });
      if (rpcError) return; // sin vistas medidas, la conversion queda en blanco
      const rows: DailyRow[] = (data ?? []).map((r) => ({ day: r.day, views: r.views, starts: r.starts, submissions: r.submissions, spam: r.spam, rejected: r.rejected }));
      const current = stats.get(f.id);
      if (current) current.views = summarize(rows).views;
    }),
  );

  const rows = (forms ?? []).map((f) =>
    formListRow(
      {
        id: f.id,
        name: f.name,
        type: f.type as FormType,
        status: f.status as FormStatus,
        slug: f.slug,
        updated_at: f.updated_at,
        design: f.design,
        draft_definition: f.draft_definition,
        survey_config: f.survey_config,
      },
      stats.get(f.id),
    ),
  );

  return (
    <FormsList
      rows={rows}
      canManage={ctx.can("forms.manage")}
      loadError={!!error}
      initialQuery={initialQuery}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      timeZone={timeZone}
      nowIso={new Date().toISOString()}
    />
  );
}
