/**
 * Las opciones del selector «Cambiar» servicio de una reunión (Servicios A4, F136). PURA.
 *
 * Solo los servicios DEL CONTACTO de la reunión (el servidor vuelve a mirarlo), los que cubren la fecha de la reunión
 * primero, después el resto (los cancelados al final), y siempre «Ninguno».
 */

export type ServiceOptionInput = {
  id: string;
  label: string;
  contactId: string;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
};

export type ServiceOption = { id: string | null; label: string; covers: boolean };

function covers(s: ServiceOptionInput, day: string): boolean {
  if (s.status === "cancelled") return false;
  if (s.status === "pending_confirmation") return true;
  if (s.startsOn && s.startsOn > day) return false;
  if (s.endsOn && day > s.endsOn) return false;
  return true;
}

export function serviceLinkOptions(services: readonly ServiceOptionInput[], contactId: string | null, recordedOn: string): ServiceOption[] {
  if (!contactId) return [{ id: null, label: "Ninguno", covers: false }];
  const mine = services.filter((s) => s.contactId === contactId);
  const rank = (s: ServiceOptionInput) => (covers(s, recordedOn) ? 0 : s.status === "cancelled" ? 2 : 1);
  const sorted = [...mine].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, "es"));
  return [
    ...sorted.map((s) => ({ id: s.id, label: s.status === "cancelled" ? `${s.label} (cancelado)` : s.label, covers: covers(s, recordedOn) })),
    { id: null, label: "Ninguno", covers: false },
  ];
}

/** Si un servicio puede elegirse para esta reunión (lo mira el servidor antes de guardar). */
export function serviceAllowedForCall(service: { contactId: string; workspaceId: string } | null, call: { contactId: string | null; workspaceId: string }): boolean {
  if (!service) return false;
  return service.workspaceId === call.workspaceId && call.contactId !== null && service.contactId === call.contactId;
}
