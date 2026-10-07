import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadWorkspaceAgents } from "@/lib/agent/config";
import { findAdjacentRun, getRunDetail } from "@/lib/agent/runs-query";
import { loadRunsScreenInputs } from "@/lib/agent/runs-screen-data";
import { RUN_SOURCE_LABELS, RUN_STATUS_LABELS } from "@/lib/agent/run-labels";
import { RunDetail } from "@/components/agents/run-detail";
import { PageHeader } from "@/components/page-header";
import { resolveViewerTimezone } from "@/lib/user-timezone";

/**
 * El detalle de una corrida sola (R4): el mismo componente `RunDetail` que
 * usa la fila expandida de Corridas. Bifurca por rol como `[agentId]/page.tsx`:
 * service role detras de `ai_costs.view` para quien lo tiene, cliente del
 * usuario para el resto (la RLS de la 00060 hace el resto: otro workspace,
 * o un Member sin acceso a esta conversacion, da 404).
 *
 * Anterior/siguiente respetan los filtros con los que se llego (los mismos
 * query params que trae la URL).
 */
export default async function AgentRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { runId } = await params;
  const { workspace, supabase } = await getWorkspace();
  const service = await createServiceClient();
  const permissions = await getPermissionContext();
  const includeCost = permissions.can("ai_costs.view");
  const client = includeCost ? service : supabase;
  const timeZone = await resolveViewerTimezone((workspace as { timezone?: string }).timezone);

  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") urlParams.set(k, v);

  const agents = await loadWorkspaceAgents(service, workspace.id);
  const agentNames = new Map(agents.map((a) => [a.id, a.name]));

  const run = await getRunDetail(client, {
    runId,
    workspaceId: workspace.id,
    includeCost,
    agentNames,
    channelLabels: new Map(),
  });
  if (!run) notFound();

  // El canal se resuelve aparte: no hace falta la lista completa de canales
  // para una sola corrida, alcanza con su propio channel_id.
  if (run.channelId) {
    const { data: ch } = await client.from("channels").select("id, platform, username, display_name").eq("id", run.channelId).maybeSingle();
    if (ch) run.channelLabel = ch.display_name ?? (ch.username ? `@${ch.username}` : ch.platform);
  }

  // Anterior/siguiente, con el mismo filtro que trajo hasta aca (R4).
  let prevId: string | null = null;
  let nextId: string | null = null;
  if (urlParams.toString()) {
    const { filters, dateRange } = await loadRunsScreenInputs({
      workspaceId: workspace.id,
      timeZone,
      service,
      userClient: supabase,
      includeCost,
      searchParams: urlParams,
      rawParams: sp,
    });
    [prevId, nextId] = await Promise.all([
      findAdjacentRun(client, { workspaceId: workspace.id, filters, includeCost, dateRange, anchorCreatedAt: run.createdAt, direction: "anterior" }),
      findAdjacentRun(client, { workspaceId: workspace.id, filters, includeCost, dateRange, anchorCreatedAt: run.createdAt, direction: "siguiente" }),
    ]);
  }

  const qs = urlParams.toString();
  const withQs = (id: string) => `/dashboard/agents/runs/${id}${qs ? `?${qs}` : ""}`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/agents/runs/[runId]"
        title={RUN_STATUS_LABELS[run.status] ?? run.status}
        tooltip={`${RUN_SOURCE_LABELS[run.source] ?? run.source}${run.agentName ? ` · ${run.agentName}` : ""}`}
        backHref={
          <Link
            href={qs ? `/dashboard/agents/runs?${qs}` : "/dashboard/agents/runs"}
            aria-label="Volver a Corridas"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
        right={
          (prevId || nextId) && (
            <div className="flex gap-1">
              <Link
                href={prevId ? withQs(prevId) : "#"}
                aria-disabled={!prevId}
                className={`rounded-lg border border-border px-2 py-1 text-xs ${prevId ? "hover:bg-accent" : "pointer-events-none opacity-40"}`}
              >
                ← Anterior
              </Link>
              <Link
                href={nextId ? withQs(nextId) : "#"}
                aria-disabled={!nextId}
                className={`rounded-lg border border-border px-2 py-1 text-xs ${nextId ? "hover:bg-accent" : "pointer-events-none opacity-40"}`}
              >
                Siguiente →
              </Link>
            </div>
          )
        }
      />

      <div className="flex-1 overflow-auto px-4 py-6 md:px-8">
        <RunDetail run={run} showCost={includeCost} />
      </div>
    </div>
  );
}
