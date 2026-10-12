import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/forms/back-link";
import { ReportsView } from "@/components/eod/reports/reports-view";
import { loadReportsPage } from "@/lib/eod/reports-load";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La pestaña Reportes de un EOD (E9). Un Member ve solo los suyos; Owner, Admin y un rol con
 * `eod.view_all`, los enviados de todos (lo decide la RLS, no esta página).
 */
export default async function EodReportesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("forms.view");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const data = await loadReportsPage(ctx, id, sp);
  if (!data) notFound();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={`Reportes · ${data.form.name}`} route="/dashboard/formularios/[id]/reportes" backHref={<BackLink href={`/dashboard/formularios/${id}`} label="Volver al reporte" />} />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {!data.canViewAll && <p className="mb-4 text-xs text-muted-foreground">Ves tus propios reportes. Los de todo el equipo los ven Owner, Admin y quien tiene el permiso de verlos.</p>}
        <ReportsView data={data} />
      </div>
    </div>
  );
}
