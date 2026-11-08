// @plantilla-quitar(servicios)
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { isModuleEnabled, moduleShows } from "@/lib/services/module";
import { ImportServicesView } from "@/components/services/clients/import-services-view";

/** Clientes › Importar servicios (F99). Pide `services.import`. */
export default async function ImportServicesPage() {
  const { workspace } = await requirePermission("services.import");
  if (!moduleShows("route.clientes", { servicesEnabled: isModuleEnabled(workspace as { services_enabled?: boolean | null }) })) notFound();
  return <ImportServicesView />;
}
