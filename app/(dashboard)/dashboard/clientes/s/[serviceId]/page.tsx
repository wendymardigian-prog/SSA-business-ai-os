// @plantilla-quitar(servicios)
import { notFound, redirect } from "next/navigation";
import { legacyServiceRedirect } from "@/lib/services/screens/record-url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El link viejo de la ficha del servicio (F29). Desde Servicios A2 la ficha es un modal encima de Clientes
 * (`?servicio=`): este link lleva ahí, así no se rompe ninguno guardado (avisos, mails, marcadores).
 */
export default async function LegacyServicePage({ params, searchParams }: { params: Promise<{ serviceId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ serviceId }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(serviceId)) notFound();
  redirect(legacyServiceRedirect(serviceId, sp.tab));
}
