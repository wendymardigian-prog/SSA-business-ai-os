import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { MetricsView } from "@/components/forms/responses/metrics-view";
import { fieldsOf } from "@/lib/forms/server-ports";
import { calcularMetricasDelFormulario } from "@/lib/forms/field-metrics";
import { dayInZone, resolvePeriod, type DailyRow } from "@/lib/forms/metrics";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Métricas de un formulario (F14). No hay tabla de contadores: vistas, inicios y
 * rechazados salen de `analytics_events` y los envíos de `form_submissions`,
 * agrupados por día en la zona del workspace por `form_metrics_daily`. Un Member
 * ve los totales (son conteos del formulario entero), no las respuestas.
 */
export default async function MetricasPage({
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

  const { data: form } = await supabase.from("forms").select("id, name, type, current_version_id, draft_definition").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!form) notFound();

  const timeZone = workspace.timezone || "UTC";
  const viewerZone = await resolveViewerTimezone(workspace.timezone);
  const period = resolvePeriod({ dias: one("dias"), desde: one("desde"), hasta: one("hasta") }, dayInZone(new Date(), timeZone));

  const { data: daily, error } = await supabase.rpc("form_metrics_daily", { p_form_id: id, p_from: period.from, p_to: period.to });
  const rows: DailyRow[] = (daily ?? []).map((r) => ({ day: r.day, views: r.views, starts: r.starts, submissions: r.submissions, spam: r.spam, rejected: r.rejected }));

  // Métricas por campo: sobre las respuestas del período que esta persona ve.
  let definition = form.draft_definition;
  if (form.current_version_id) {
    const { data: version } = await supabase.from("form_versions").select("definition").eq("id", form.current_version_id).maybeSingle();
    if (version) definition = version.definition;
  }
  const { data: answerRows } = await supabase
    .from("form_submissions")
    .select("answers")
    .eq("form_id", id)
    .eq("workspace_id", workspace.id)
    .neq("status", "spam")
    .gte("created_at", new Date(`${period.from}T00:00:00Z`).toISOString())
    .lte("created_at", new Date(`${period.to}T23:59:59Z`).toISOString())
    .order("created_at", { ascending: true })
    .limit(3000);

  const fields = fieldsOf(definition).map((f) => ({ id: f.key, label: f.label, type: f.type, options: f.options ?? null }));
  const values = (answerRows ?? []).map((r) => {
    const out: Record<string, unknown> = {};
    for (const [key, a] of Object.entries((r.answers ?? {}) as Record<string, { value?: unknown }>)) out[key] = a?.value;
    return out;
  });
  const fieldMetrics = calcularMetricasDelFormulario(fields, values);

  return (
    <MetricsView
      formId={form.id}
      formName={form.name}
      period={period}
      rows={rows}
      fieldMetrics={fieldMetrics}
      hasAnyAnswers={values.length > 0}
      loadError={!!error}
      timeZone={viewerZone}
      activePreset={one("desde") && one("hasta") ? "custom" : one("dias") ?? "30"}
    />
  );
}
