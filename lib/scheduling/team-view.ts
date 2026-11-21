/**
 * La vista de equipo de la Agenda (vista «Día», una columna por persona): quién la ve. PURO.
 *
 * La misma regla que `google_busy_blocks` (00510): Owner, Admin, `scheduling.manage_others` o `bookings.view` con
 * alcance `all` (las personas que ya ven la agenda de otros). Nunca se ven títulos de Google ajenos: solo ocupado.
 */
export function canSeeTeamAvailability(input: {
  isAdmin: boolean;
  canManageOthers: boolean;
  canViewBookings: boolean;
  bookingsScope: string | null;
}): boolean {
  return input.isAdmin || input.canManageOthers || (input.canViewBookings && input.bookingsScope === "all");
}

/** `?equipo=0` = «Todo junto» (la vista «Día» de siempre). */
export function parseTeamLayout(value: string | string[] | null | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== "0";
}

export type TeamBusyStatus = "ok" | "no_google" | "broken" | "unavailable";

/** El aviso de una columna que no muestra el ocupado real (nunca se muestra libre si no se pudo leer). */
export const TEAM_STATUS_TEXT: Record<Exclude<TeamBusyStatus, "ok">, string> = {
  no_google: "No revisa conflictos en Google: solo se ven sus reuniones",
  broken: "Su Google Calendar está desconectado: tiene que reconectarlo",
  unavailable: "No pude leer su Google ahora: puede estar ocupado",
};

/**
 * Los bloques ocupados de una persona en un día de la grilla, en minutos desde la medianoche local de quien mira,
 * recortados al día (un ocupado que empieza el día anterior arranca en 0). Se juntan los que se pisan.
 */
export function busyBlocksForDay(
  busy: ReadonlyArray<{ startAt: string; endAt: string }>,
  dayStartUtc: string,
  dayEndUtc: string,
): Array<{ startMinutes: number; endMinutes: number }> {
  const start = Date.parse(dayStartUtc);
  const end = Date.parse(dayEndUtc);
  const blocks = busy
    .map((b) => ({ s: Math.max(Date.parse(b.startAt), start), e: Math.min(Date.parse(b.endAt), end) }))
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s)
    .sort((a, b) => a.s - b.s);
  const merged: Array<{ s: number; e: number }> = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && b.s <= last.e) last.e = Math.max(last.e, b.e);
    else merged.push({ ...b });
  }
  return merged.map((b) => ({ startMinutes: Math.round((b.s - start) / 60_000), endMinutes: Math.round((b.e - start) / 60_000) }));
}

/** Dónde se recuerda en el navegador la elección «Por persona / Todo junto». */
export const TEAM_LAYOUT_STORAGE_KEY = "ssa:agenda:equipo";
