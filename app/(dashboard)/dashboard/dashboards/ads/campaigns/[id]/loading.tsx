import { PageHeader } from "@/components/page-header";
import { AdsPageSkeleton } from "@/components/dashboards/ads/skeletons";

/** Mientras llegan los datos del detalle: la misma disposicion, en gris. */
export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/dashboards/ads/campaigns/[id]" />
      <AdsPageSkeleton />
    </div>
  );
}
