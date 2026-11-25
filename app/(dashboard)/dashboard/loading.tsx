import { PanelFallbackSkeleton } from "@/components/panel-fallback-skeleton";

/** Lo que se ve mientras carga una pantalla del panel sin `loading.tsx` propio: su título y su forma. */
export default function DashboardLoading() {
  return <PanelFallbackSkeleton />;
}
