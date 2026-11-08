/**
 * Lo que arma el detalle de una reunión para mostrar (Agenda): textos del
 * historial, la categoría congelada y las respuestas con su etiqueta. Puro:
 * lo usa la acción que carga el detalle aparte de la página.
 */
import { ORIGIN_LABELS } from "@/lib/scheduling/agenda-filters";
import type { BookingField } from "@/lib/scheduling/types";

export function snapshotLabel(snapshot: unknown): string {
  const snap = snapshot as { area_name?: string | null; type_name?: string | null } | null;
  if (!snap?.area_name) return "";
  return snap.type_name ? `${snap.area_name} · ${snap.type_name}` : snap.area_name;
}

/**
 * Las respuestas con la etiqueta del formulario. Si el evento cambió de
 * preguntas, la clave se muestra tal cual: es preferible a esconder una
 * respuesta que la persona sí escribió.
 */
export function answersOf(responses: unknown, fields: BookingField[] | null | undefined): Array<{ label: string; value: string }> {
  const byId = new Map((fields ?? []).map((f) => [f.identifier, f.label]));
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries((responses as Record<string, unknown>) ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    out.push({ label: byId.get(key) ?? key, value: Array.isArray(value) ? value.join(", ") : String(value) });
  }
  return out;
}

/** Una línea del historial en palabras. */
export function historyText(entry: { action: string; metadata: unknown; changes: unknown; performed_by: string | null }, names: Map<string, string>): string {
  const who = entry.performed_by ? names.get(entry.performed_by) ?? "Alguien del equipo" : "El sistema";
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const changes = (entry.changes ?? {}) as Record<string, { old?: unknown; new?: unknown }>;

  switch (entry.action) {
    case "booking.created":
      return `Se agendó (${ORIGIN_LABELS[meta.origin as keyof typeof ORIGIN_LABELS] ?? meta.origin ?? "origen desconocido"})`;
    case "booking.rescheduled":
      return `${who} cambió la fecha`;
    case "booking.cancelled":
      return `${meta.by === "invitee" ? "El invitado" : who} canceló${meta.reason ? `: ${meta.reason}` : ""}`;
    case "booking.status_changed":
      return `${who} cambió el estado a ${String(changes.status?.new ?? "")}`;
    case "booking.updated":
      return `${who} editó la agenda`;
    case "booking.sync_ok":
      return "Google Calendar quedó al día";
    case "booking.sync_failed":
      return `No se pudo sincronizar con Google${meta.error ? `: ${meta.error}` : ""}`;
    case "booking.slot_released":
      return `${who} liberó el espacio: otro lead puede agendar este horario`;
    case "booking.slot_occupied":
      return `${who} volvió a ocupar el espacio`;
    case "booking.host_changed":
      return `${who} reasignó el anfitrión`;
    default:
      return entry.action;
  }
}
