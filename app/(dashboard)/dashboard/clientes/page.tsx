// @plantilla-quitar(servicios)
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { parseServiceFilters } from "@/lib/services/screens/list";
import { loadServicesPage } from "@/lib/services/screens/load-services";
import { loadNewServiceOptions } from "@/lib/services/screens/load-new-service";
import { todayIn } from "@/lib/services/screens/today";
import { ServicesListView } from "@/components/services/clients/services-list-view";

/**
 * Clientes › Servicios (F26). Pide `services.view`; con el modulo apagado, 404. La RLS decide que servicios ve cada
 * persona (un Member, solo los suyos).
 */
export default async function ClientesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("services.view");
  const { workspace, supabase } = ctx;
  if (!moduleShows("route.clientes", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  const filters = parseServiceFilters(await searchParams);
  const team = await getWorkspaceMembers(workspace.id);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const [page, options] = await Promise.all([
    loadServicesPage(supabase, workspace.id, filters, names),
    ctx.can("services.create") ? loadNewServiceOptions(supabase, workspace.id, team, ctx.can("services.create_off_rule"), (workspace as { timezone?: string | null }).timezone) : Promise.resolve({ products: [], members: [], canOffRule: false }),
  ]);
  return (
    <ServicesListView
      items={page.items}
      total={page.total}
      departed={page.departed}
      filters={filters}
      today={todayIn((workspace as { timezone?: string }).timezone)}
      canCreate={ctx.can("services.create")}
      canImport={ctx.can("services.import")}
      newServiceOptions={options}
    />
  );
}
