import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadRuns } from "@/lib/agent/runs-query";
import { loadRunsScreenInputs } from "@/lib/agent/runs-screen-data";
import { runsToCsv } from "@/lib/agent/runs-csv";
import { resolveViewerTimezone } from "@/lib/user-timezone";

/**
 * Export a CSV de Corridas (R3), con el mismo filtro que la pantalla.
 *
 * El permiso se respeta pidiendo o no las columnas de costo, nunca
 * ocultandolas despues: sin `ai_costs.view`, `includeCost` es false y
 * `loadRuns` ni siquiera las selecciona (00060).
 */
export async function GET(request: NextRequest) {
  const { workspace, supabase } = await getWorkspace();
  const service = await createServiceClient();
  const permissions = await getPermissionContext();
  const includeCost = permissions.can("ai_costs.view");
  const timeZone = await resolveViewerTimezone((workspace as { timezone?: string }).timezone);

  const searchParams = request.nextUrl.searchParams;
  const rawParams: Record<string, string> = {};
  searchParams.forEach((v, k) => {
    rawParams[k] = v;
  });

  const { filters, dateRange, client, agents, channels } = await loadRunsScreenInputs({
    workspaceId: workspace.id,
    timeZone,
    service,
    userClient: supabase,
    includeCost,
    searchParams,
    rawParams,
  });

  // Hasta 5000 filas por export: mas que una pantalla entera de auditoria, y
  // sin el limite de 1.000 de PostgREST por el `.range` explicito.
  const { rows } = await loadRuns(client, {
    workspaceId: workspace.id,
    filters: { ...filters, page: 1 },
    includeCost,
    agentNames: new Map(agents.map((a) => [a.id, a.name])),
    channelLabels: new Map(channels.map((c) => [c.id, c.label])),
    dateRange,
    pageSize: 5000,
  });

  const csv = runsToCsv(rows, { includeCost });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="corridas.csv"`,
    },
  });
}
