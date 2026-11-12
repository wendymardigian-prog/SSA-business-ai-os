// @plantilla-quitar(servicios)
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { loadClientsList } from "@/lib/services/screens/load-clients";
import { loadNewServiceOptions } from "@/lib/services/screens/load-new-service";
import { parseClientsUrl } from "@/lib/services/screens/clients-list";
import { createServiceClient } from "@/lib/supabase/server";
import { loadTableViews } from "@/lib/ui/data-table/views-load";
import { CLIENTS_TABLE_KEY } from "@/lib/services/screens/clients-columns";
import { ClientsListView } from "@/components/services/clients/clients-list-view";
import { RecordsHost } from "@/components/services/records/records-host";

/**
 * Clientes › Clientes (F27, Servicios A2): una fila por contacto con al menos un servicio que la persona ve (la RLS lo
 * decide), en tabla o tablero, agrupada por semaforo, responsable o portal. Ordenar, agrupar y buscar pasan en el
 * navegador. Las fichas se abren encima, en modal (`?cliente=`, `?servicio=`).
 */
export default async function ClientesListaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("services.view");
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.clientes", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const sp = await searchParams;
  // Las vistas guardadas de la tabla (#220): si la URL llegó pelada, se aplican los filtros de la predeterminada.
  const viewsData = await loadTableViews(ctx, CLIENTS_TABLE_KEY, sp);
  const inherited = viewsData.resolved.inheritedFilters;
  const team = await getWorkspaceMembers(workspace.id);
  const [{ rows, truncated }, options] = await Promise.all([
    loadClientsList(supabase, await createServiceClient(), workspace.id, new Map(team.map((m) => [m.userId, m.name]))),
    ctx.can("services.create") ? loadNewServiceOptions(supabase, workspace.id, team, ctx.can("services.create_off_rule"), (workspace as { timezone?: string | null }).timezone) : Promise.resolve({ products: [], members: [], canOffRule: false }),
  ]);
  return (
    <ClientsListView
      rows={rows}
      truncated={truncated}
      initial={parseClientsUrl(inherited ? new URLSearchParams(inherited) : sp)}
      views={{
        items: viewsData.views,
        defaultViewId: viewsData.defaultViewId,
        activeId: viewsData.resolved.active?.id ?? null,
        viewParam: viewsData.resolved.viewParam,
        activeBase: viewsData.resolved.active?.config.columns ?? null,
        userId: viewsData.userId,
        isAdmin: viewsData.isAdmin,
      }}
      members={team.map((m) => ({ id: m.userId, name: m.name }))}
      canCreate={ctx.can("services.create")}
      newServiceOptions={options}
      records={<RecordsHost ctx={ctx} searchParams={sp} />}
    />
  );
}
