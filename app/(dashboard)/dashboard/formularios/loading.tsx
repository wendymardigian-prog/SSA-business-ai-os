import { PageSkeleton } from "@/components/page-skeleton";

/** La lista de formularios: tarjetas esqueleto mientras carga (plano formularios-ui, F6). */
export default function Loading() {
  return <PageSkeleton variant="cards" />;
}
