import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";

/**
 * Ventas: la lista de ventas (se arma en el Bloque 3). Por ahora, el lugar del
 * menú con su estado vacío. Pide `sales.view`: sin ese permiso redirige.
 */
export default async function VentasPage() {
  await requirePermission("sales.view");

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/ventas" />
      <div className="flex flex-1 items-center justify-center px-4 py-16 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium">Todavía no hay ventas</p>
          <p className="text-xs text-muted-foreground">Cuando cargues la primera, la vas a ver acá con su plan de pagos y su estado.</p>
        </div>
      </div>
    </div>
  );
}
