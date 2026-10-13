/**
 * Lo que lee la pestaña Reportes de un EOD (E9). Los reportes se leen con el cliente de la
 * PERSONA: la RLS decide (cada uno ve los suyos; Owner, Admin y `eod.view_all`, los enviados
 * de todos; los borradores ajenos, nadie). "Pendientes de hoy" lee solo el ESTADO de los
 * reportes de la audiencia, con el cliente de servicio, y solo para quien ve a todo el equipo.
 */
import type { PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { todayInputValue } from "@/lib/dates";
import { isValidTimeZone } from "@/lib/timezone";
import type { FormDefinition } from "@/lib/forms/fields";
import { isInAudience } from "./audience";
import { parseStoredEodConfig, type EodConfig } from "./config";
import { eodParts } from "./definition";
import { metricKeysOf, type EodMetrics } from "./metrics";
import { loadTeam } from "./server-ports";
import { applyChannelFilter, parseReportFilters, pendingToday, type EodReportListRow, type PendingPerson, type ReportFilters } from "./reports";

export const REPORT_COLUMNS =
  "id, user_id, report_date, status, submitted_at, edited_at, edit_count, metrics, channels, form_version_id" as const;

export interface ReportsPageData {
  form: { id: string; name: string; config: EodConfig };
  timeZone: string;
  today: string;
  filters: ReportFilters;
  metricKeys: string[];
  channels: Array<{ key: string; label: string }>;
  rows: EodReportListRow[];
  people: Array<{ userId: string; name: string }>;
  canViewAll: boolean;
  pending: PendingPerson[] | null;
}

const MAX_ROWS = 5_000;

export async function loadReportsPage(ctx: PermissionContext, formId: string, params: Record<string, string | undefined>): Promise<ReportsPageData | null> {
  const { supabase, workspace } = ctx;
  const { data: form } = await supabase
    .from("forms")
    .select("id, name, type, eod_config, current_version_id, draft_definition")
    .eq("id", formId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!form || form.type !== "eod") return null;
  const config = parseStoredEodConfig(form.eod_config);
  if (!config) return null;

  let definition = form.draft_definition as unknown;
  if (form.current_version_id) {
    const { data: version } = await supabase.from("form_versions").select("definition").eq("id", form.current_version_id).maybeSingle();
    if (version) definition = version.definition;
  }
  const parts = eodParts(definition as Partial<FormDefinition>);

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const today = todayInputValue(new Date(), timeZone);
  const filters = parseReportFilters(params, today);

  let query = supabase
    .from("eod_reports")
    .select(REPORT_COLUMNS)
    .eq("form_id", form.id)
    .eq("workspace_id", workspace.id)
    .gte("report_date", filters.from)
    .lte("report_date", filters.to);
  if (filters.person) query = query.eq("user_id", filters.person);
  const [{ data: reportRows, error }, members] = await Promise.all([
    query.order("report_date", { ascending: false }).order("submitted_at", { ascending: false }).limit(MAX_ROWS),
    getWorkspaceMembers(workspace.id),
  ]);
  if (error) console.error(`[eod] no pude leer los reportes (code=${error.code})`);
  const names = new Map(members.map((m) => [m.userId, m.name]));

  const rows: EodReportListRow[] = applyChannelFilter(
    (reportRows ?? []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: names.get(r.user_id) ?? "Alguien que ya no está en el equipo",
      reportDate: r.report_date,
      status: r.status,
      submittedAt: r.submitted_at,
      editedAt: r.edited_at,
      editCount: r.edit_count,
      metrics: (r.metrics ?? {}) as unknown as EodMetrics,
      channelKeys: r.status === "submitted" ? Object.keys((r.channels ?? {}) as Record<string, unknown>) : [],
    })),
    filters.channel,
  );

  const canViewAll = ctx.can("eod.view_all");
  const pending = canViewAll ? await loadPendingToday(workspace.id, form.id, config) : null;

  const people = [...new Map([...rows.map((r) => [r.userId, r.userName] as const), ...members.map((m) => [m.userId, m.name] as const)]).entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  return {
    form: { id: form.id, name: form.name, config },
    timeZone,
    today,
    filters,
    metricKeys: metricKeysOf(parts.fields, parts.channels.filter((c) => c.enabled)),
    channels: parts.channels.filter((c) => c.enabled).map((c) => ({ key: c.key, label: c.label })),
    rows,
    people: canViewAll ? people : people.filter((p) => p.userId === ctx.user.id),
    canViewAll,
    pending,
  };
}

/** Quién de la audiencia todavía no envió el de hoy (el hoy de cada uno, en su zona). */
async function loadPendingToday(workspaceId: string, formId: string, config: EodConfig): Promise<PendingPerson[]> {
  const service = await createServiceClient();
  const [team, { data: ws }] = await Promise.all([loadTeam(service, workspaceId), service.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle()]);
  const audience = team.filter((m) => isInAudience(config, m));
  if (audience.length === 0) return [];
  const { data: prefs } = await service.from("user_preferences").select("user_id, timezone").in(
    "user_id",
    audience.map((m) => m.userId),
  );
  const tzOf = new Map((prefs ?? []).map((p) => [p.user_id, p.timezone]));
  const fallback = ws?.timezone && isValidTimeZone(ws.timezone) ? ws.timezone : "UTC";
  const now = new Date();
  const withToday = audience.map((m) => {
    const tz = tzOf.get(m.userId);
    return { userId: m.userId, name: m.name, today: todayInputValue(now, tz && isValidTimeZone(tz) ? tz : fallback) };
  });
  const dates = [...new Set(withToday.map((m) => m.today))];
  // Solo el estado: el contenido de un borrador ajeno no sale de la base.
  const { data: statuses } = await service
    .from("eod_reports")
    .select("user_id, report_date, status")
    .eq("form_id", formId)
    .in("report_date", dates)
    .in(
      "user_id",
      withToday.map((m) => m.userId),
    );
  const byKey = new Map((statuses ?? []).map((s) => [`${s.user_id}:${s.report_date}`, s.status as "draft" | "submitted"]));
  return pendingToday(withToday, (userId, date) => byKey.get(`${userId}:${date}`) ?? null);
}
