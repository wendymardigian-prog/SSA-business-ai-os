"use server";

import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { appUrl } from "@/lib/app-url";
import { parseStoredEodConfig } from "@/lib/eod/config";
import { eodVariables, flattenVariables } from "@/lib/eod/automation/variables";
import { shortDate } from "@/lib/eod/dates";
import type { EodMetrics } from "@/lib/eod/metrics";
import type { LabeledAnswer } from "@/lib/forms/submission-schema";
import type { TestValues } from "@/lib/automations/explain-paths";

/**
 * "Probar condiciones" de una automatización de un reporte de fin de día (E16), con un
 * reporte ENVIADO real. SOLO LECTURA: nunca escribe nada. Con el cliente de quien pide: la
 * RLS decide qué reportes ve (los suyos, o los de todos con `eod.view_all`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "No encontré esa automatización.";
const LIMIT = 20;
const COLUMNS = "id, user_id, report_date, edit_count, answers, channels, metrics, submitted_at" as const;

async function eodOfFlow(flowId: string): Promise<{ error: string } | { error?: undefined; ctx: PermissionContext; form: { id: string; name: string; roleLabel: string } }> {
  const ctx = await getPermissionAction("forms.view");
  if (!ctx) return { error: "No tenés permiso para ver los reportes." };
  if (!UUID.test(flowId)) return { error: NOT_FOUND };
  const { supabase, workspace } = ctx;
  const { data: flow } = await supabase.from("flows").select("form_id").eq("id", flowId).eq("workspace_id", workspace.id).maybeSingle();
  if (!flow?.form_id) return { error: NOT_FOUND };
  const { data: form } = await supabase.from("forms").select("id, name, type, eod_config").eq("id", flow.form_id).eq("workspace_id", workspace.id).maybeSingle();
  if (!form || form.type !== "eod") return { error: NOT_FOUND };
  return { ctx, form: { id: form.id, name: form.name, roleLabel: parseStoredEodConfig(form.eod_config)?.roleLabel ?? "" } };
}

export async function listEodTestReports(input: { flowId: string }): Promise<{ ok: true; formName: string; responses: Array<{ id: string; label: string }> } | { ok: false; error: string }> {
  const found = await eodOfFlow(input.flowId);
  if (!("ctx" in found)) return { ok: false, error: found.error };
  const { ctx, form } = found;
  const [{ data, error }, members] = await Promise.all([
    ctx.supabase.from("eod_reports").select("id, user_id, report_date").eq("form_id", form.id).eq("status", "submitted").order("submitted_at", { ascending: false }).limit(LIMIT),
    getWorkspaceMembers(ctx.workspace.id),
  ]);
  if (error) return { ok: false, error: "No pude cargar los reportes. Probá de nuevo." };
  const names = new Map(members.map((m) => [m.userId, m.name]));
  return {
    ok: true,
    formName: form.name,
    responses: (data ?? []).map((r) => ({ id: r.id, label: `${names.get(r.user_id) ?? "Alguien del equipo"} · ${shortDate(r.report_date)}` })),
  };
}

export async function getEodTestValues(input: { flowId: string; submissionId: string }): Promise<{ ok: true; values: TestValues } | { ok: false; error: string }> {
  if (!UUID.test(input.submissionId)) return { ok: false, error: "No encontré ese reporte." };
  const found = await eodOfFlow(input.flowId);
  if (!("ctx" in found)) return { ok: false, error: found.error };
  const { ctx, form } = found;
  const [{ data: report }, members] = await Promise.all([
    ctx.supabase.from("eod_reports").select(COLUMNS).eq("id", input.submissionId).eq("form_id", form.id).eq("status", "submitted").maybeSingle(),
    getWorkspaceMembers(ctx.workspace.id),
  ]);
  if (!report) return { ok: false, error: "No encontré ese reporte." };
  const member = members.find((m) => m.userId === report.user_id);
  const vars = eodVariables({
    form,
    report: {
      id: report.id,
      reportDate: report.report_date,
      editCount: report.edit_count,
      answers: (report.answers ?? {}) as unknown as Record<string, LabeledAnswer>,
      channels: (report.channels ?? {}) as unknown as Record<string, { label: string; answers: Record<string, LabeledAnswer> }>,
      metrics: (report.metrics ?? {}) as unknown as EodMetrics,
    },
    member: { name: member?.name ?? "", email: member?.email ?? "" },
    baseUrl: appUrl(),
  });
  return { ok: true, values: flattenVariables(vars) };
}
