// @plantilla-quitar(servicios)
import { notFound, redirect } from "next/navigation";
import { clientHref } from "@/lib/services/screens/record-url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El link viejo de la ficha del cliente (F28). Desde Servicios A2 la ficha es un modal encima de Clientes
 * (`?cliente=`): este link lleva ahí, así no se rompe ninguno guardado.
 */
export default async function LegacyClientPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  if (!UUID.test(contactId)) notFound();
  redirect(clientHref(contactId, { base: "/dashboard/clientes/lista" }));
}
