import { PageHeader } from "@/components/page-header";
import { AdsPageSkeleton } from "@/components/dashboards/ads/skeletons";

/** Mientras llegan los datos: la misma disposicion que el dashboard, en gris. */
export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/dashboards/ads" />
      <AdsPageSkeleton />
    </div>
  );
}
