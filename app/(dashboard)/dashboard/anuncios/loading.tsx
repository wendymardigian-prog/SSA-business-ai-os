import { PageHeader } from "@/components/page-header";
import { CardSkeleton } from "@/components/dashboards/ads/skeletons";

/** Mientras llegan los datos: la tarjeta de la tabla, en gris. */
export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/anuncios" />
      <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6" role="status" aria-label="Cargando los anuncios">
        <CardSkeleton height="h-96" />
      </div>
    </div>
  );
}
