import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspace } from "@/lib/workspace";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { resolveDateRange } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { FlowRunsScreen } from "@/components/flows/runs/flow-runs-screen";
import { parseFlowRunFilters } from "@/lib/flows/runs";
import { loadFlowRunDetail, loadFlowRuns } from "@/lib/flows/runs-query";
import type { SearchParams } from "@/lib/url-params";

/** El historial de ejecuciones de una automatizacion (00292). Lee con el cliente del usuario: la RLS decide que ve. */
export default async function FlowRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ flowId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { flowId } = await params;
  await requirePermission("flows.view");
  const { workspace, supabase } = await getWorkspace();

  const { data: flow } = await supabase
    .from("flows")
    .select("id, name")
    .eq("id", flowId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!flow) notFound();

  const timeZone = await resolveViewerTimezone((workspace as { timezone?: string }).timezone);
  const filters = parseFlowRunFilters(await searchParams);
  const range = resolveDateRange(filters.fecha, filters.desde, filters.hasta, undefined, timeZone);

  const [{ rows, total, error }, detail] = await Promise.all([
    loadFlowRuns(supabase, { flowId, filters, dateRange: range }),
    filters.ejecucion ? loadFlowRunDetail(supabase, { flowId, runId: filters.ejecucion }) : Promise.resolve(null),
  ]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/flows/[flowId]/ejecuciones"
        title={`Ejecuciones · ${flow.name}`}
        backHref={
          <Link href={`/dashboard/flows/${flowId}`} aria-label="Volver a la automatización" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <div className="flex-1 overflow-auto px-4 py-6 md:px-8">
        <FlowRunsScreen rows={rows} total={total} loadFailed={error} filters={filters} timeZone={timeZone} detail={detail} />
      </div>
    </div>
  );
}
