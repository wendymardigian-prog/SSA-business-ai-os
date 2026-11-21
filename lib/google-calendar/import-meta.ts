/**
 * Lo que guarda una reunión pasada al sistema desde Google Calendar (`bookings.metadata.google_import`, 00510). PURO.
 * Lo leen la sincronización con Google (vincula, nunca crea otro evento) y la Papelera.
 */
export interface GoogleImportMeta {
  calendar_id: string;
  connection_id: string;
  event_id: string;
  ical_uid: string | null;
  organizer_self: boolean;
}

export function googleImportOf(metadata: unknown): GoogleImportMeta | null {
  const m = (metadata as { google_import?: Partial<GoogleImportMeta> } | null)?.google_import;
  if (!m || typeof m.event_id !== "string" || typeof m.calendar_id !== "string" || typeof m.connection_id !== "string") return null;
  return { calendar_id: m.calendar_id, connection_id: m.connection_id, event_id: m.event_id, ical_uid: m.ical_uid ?? null, organizer_self: m.organizer_self !== false };
}

