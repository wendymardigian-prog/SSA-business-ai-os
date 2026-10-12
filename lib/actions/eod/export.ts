"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { formatInZone } from "@/lib/forms/responses-query";
import { buildExportFilename } from "@/lib/forms/export";
import { loadReportsPage } from "@/lib/eod/reports-load";
import { buildReportsCsv, metricColumns } from "@/lib/eod/reports";

export type EodExportResult = { ok: true; filename: string; csv: string; rows: number } | { ok: false; error: string };

/**
 * El CSV de la pestaña Reportes, con los mismos filtros de la URL. Lee con el cliente de
 * quien exporta: la RLS decide qué reportes entran (como en la pantalla).
 */
export async function exportEodReportsCsv(input: { formId: string; params: Record<string, string> }): Promise<EodExportResult> {
  const ctx = await getPermissionAction("forms.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver formularios" };
  const page = await loadReportsPage(ctx, String(input?.formId ?? ""), input?.params ?? {});
  if (!page) return { ok: false, error: "No encontré ese reporte" };
  const csv = buildReportsCsv(page.rows, metricColumns(page.metricKeys), {
    channel: page.filters.channel,
    formatDate: (iso) => formatInZone(iso, page.timeZone),
  });
  return { ok: true, filename: buildExportFilename(page.form.name, `${page.filters.from}_${page.filters.to}`, page.today), csv, rows: page.rows.length };
}
