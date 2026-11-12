// @plantilla-quitar(servicios)
/**
 * El servicio de una reunión para su detalle (Servicios A4, F136): el actual (con el link a su ficha) y las opciones
 * del selector «Cambiar» (solo los servicios del contacto). Solo servidor; quien llama ya miró `calls.view` y leyó la
 * reunión con la sesión.
 */
import { svcSchema } from "@/lib/services/db";
import { serviceHref } from "@/lib/services/screens/record-url";
import { loadServiceLabels } from "@/lib/calls/service-labels";
import { serviceLinkOptions } from "@/lib/calls/service-link-options";
import type { CallServiceInfo } from "@/components/calls/call-service";

export async function loadCallServiceInfo(
  db: { from: (t: string) => unknown },
  input: {
    workspaceId: string;
    contactId: string | null;
    recordedAt: string | null;
    timeZone: string;
    serviceId: string | null;
    link: string | null;
    canChange: boolean;
  },
): Promise<CallServiceInfo> {
  let ids: string[] = [];
  if (input.contactId) {
    const { data } = await svcSchema(db).from("services").select("id").eq("workspace_id", input.workspaceId).eq("contact_id", input.contactId).limit(50);
    ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }
  if (input.serviceId) ids.push(input.serviceId);
  const labels = await loadServiceLabels(db, input.workspaceId, ids);
  let day = new Date().toISOString().slice(0, 10);
  try {
    if (input.recordedAt) day = new Date(input.recordedAt).toLocaleDateString("en-CA", { timeZone: input.timeZone });
  } catch {
    // Una zona rara: la fecha en UTC alcanza para ordenar las opciones.
  }
  const current = input.serviceId ? labels.get(input.serviceId) : undefined;
  return {
    current: current ? { id: current.id, label: current.label, href: serviceHref(current.id) } : null,
    link: input.link,
    options: serviceLinkOptions(
      [...labels.values()].map((l) => ({ id: l.id, label: l.label, contactId: l.contactId, status: l.status, startsOn: l.startsOn, endsOn: l.endsOn })),
      input.contactId,
      day,
    ),
    canChange: input.canChange && Boolean(input.contactId),
  };
}
