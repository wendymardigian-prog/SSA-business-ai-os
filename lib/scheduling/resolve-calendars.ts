/**
 * Qué calendarios usa un evento (F19): el destino (el del evento o el del
 * perfil) y los de conflicto (los del perfil con `check_conflicts`, o la
 * lista propia del evento). Los inactivos o desconectados se ignoran.
 */

export interface CalendarForResolve {
  id: string;
  name: string;
  access_role: "owner" | "writer" | "reader" | "freeBusyReader";
  check_conflicts: boolean;
  is_active: boolean;
  /** true si su conexión está revocada o con error. */
  connection_broken?: boolean;
  /** La conexión a la que pertenece. Hace falta para decidir si bloquea (F7). */
  connection_id?: string;
}

export interface ResolvedCalendars {
  destination: CalendarForResolve | null;
  conflicts: CalendarForResolve[];
  mode: "profile" | "custom";
  warnings: Array<"no_conflict_calendars" | "destination_unavailable">;
}

export function resolveEventCalendars(
  eventType: { destination_calendar_id?: string | null; conflict_calendar_ids?: string[] | null },
  profile: { default_destination_calendar_id?: string | null } | null,
  calendars: CalendarForResolve[],
): ResolvedCalendars {
  const usable = calendars.filter((c) => c.is_active && !c.connection_broken);
  const byId = new Map(usable.map((c) => [c.id, c]));

  const destinationId = eventType.destination_calendar_id ?? profile?.default_destination_calendar_id ?? null;
  const destination = destinationId ? (byId.get(destinationId) ?? null) : null;
  const warnings: ResolvedCalendars["warnings"] = [];
  if (destinationId && !destination) warnings.push("destination_unavailable");

  const custom = eventType.conflict_calendar_ids ?? [];
  const mode: ResolvedCalendars["mode"] = custom.length > 0 ? "custom" : "profile";
  const conflicts = mode === "custom" ? custom.map((id) => byId.get(id)).filter((c): c is CalendarForResolve => Boolean(c)) : usable.filter((c) => c.check_conflicts);
  if (mode === "custom" && conflicts.length === 0) warnings.push("no_conflict_calendars");

  return { destination, conflicts, mode, warnings };
}

export const RESOLVE_WARNING_TEXT = {
  no_conflict_calendars: "Los calendarios elegidos para este evento ya no están disponibles: no se revisan conflictos de Google.",
  destination_unavailable: "El calendario destino ya no está disponible. Elegí otro.",
} as const;
