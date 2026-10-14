import { PageSkeleton } from "@/components/page-skeleton";

/**
 * El editor de un formulario y sus pestañas (respuestas, metricas, encuesta, reportes): sin este archivo
 * heredarian el esqueleto de tarjetas de la lista, que no se parece en nada.
 */
export default function Loading() {
  return <PageSkeleton variant="form" />;
}
