/**
 * Asignación del contacto al agendar (F22): "Al agendar, asignar al
 * anfitrión como…". Solo si el campo está vacío: nunca pisa una asignación
 * hecha a mano (§4.3).
 */
import type { ContactAssignment } from "./types";

export const CONTACT_ASSIGNMENT_LABELS: Record<ContactAssignment, string> = {
  none: "No asignar",
  setter_if_empty: "Setter, si el contacto no tiene",
  vendedor_if_empty: "Vendedor, si el contacto no tiene",
};

export interface ContactAssignmentFields {
  setter_id: string | null;
  vendedor_id: string | null;
}

/** El patch a aplicar sobre el contacto ({} si no hay nada que cambiar). */
export function applyContactAssignment(
  contact: ContactAssignmentFields,
  hostId: string,
  mode: ContactAssignment,
): Partial<ContactAssignmentFields> {
  if (mode === "setter_if_empty" && !contact.setter_id) return { setter_id: hostId };
  if (mode === "vendedor_if_empty" && !contact.vendedor_id) return { vendedor_id: hostId };
  return {};
}

/**
 * El valor por defecto según el área (F22): Ventas (área de sistema) →
 * vendedor si está vacío; Servicio y cualquier otra área → no asignar.
 */
export function defaultAssignmentForArea(area: { name: string; is_system: boolean } | null | undefined): ContactAssignment {
  if (area && area.is_system && area.name.trim().toLowerCase() === "ventas") return "vendedor_if_empty";
  return "none";
}
