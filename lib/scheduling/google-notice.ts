/**
 * Aviso sin Google Calendar (traído de RER-BAIOS). Si la persona no tiene Google Calendar conectado, la agenda
 * funciona igual pero sus reuniones quedan solo en el sistema (sin evento en Google ni link de Meet) y su
 * disponibilidad no ve sus compromisos personales. Se avisa en Mi cuenta, en la pantalla de agenda y en la
 * disponibilidad (con el selector de persona, a quien maneja la de otros). Una conexión rota tiene su propio aviso
 * (reconectar), que corta los horarios: por eso se distinguen los dos casos.
 */

export type GoogleCalendarState = "connected" | "broken" | "none";

/** Estados de `oauth_connections.status` para `google_calendar`. «attention» sigue funcionando: no es «rota». */
const WORKING = new Set(["active", "attention"]);
const BROKEN = new Set(["revoked", "error"]);

/** Con al menos una cuenta que funciona, conectada; si todas están rotas, rota; sin ninguna, sin Google. */
export function googleCalendarState(statuses: readonly (string | null | undefined)[]): GoogleCalendarState {
  if (statuses.some((s) => s && WORKING.has(s))) return "connected";
  if (statuses.some((s) => s && BROKEN.has(s))) return "broken";
  return "none";
}

/** El estado de cada persona a partir de las filas de `oauth_connections` (solo user_id y status). */
export function googleCalendarStatesByUser(rows: ReadonlyArray<{ user_id: string | null; status: string }>, userIds: readonly string[]): Record<string, GoogleCalendarState> {
  const out: Record<string, GoogleCalendarState> = {};
  for (const id of userIds) out[id] = googleCalendarState(rows.filter((r) => r.user_id === id).map((r) => r.status));
  return out;
}

/** La etiqueta corta para una lista de personas (el selector de Disponibilidad). Conectado: nada. */
export function googleStateTag(state: GoogleCalendarState | undefined): string | null {
  if (state === "none") return "sin Google Calendar";
  if (state === "broken") return "Google desconectado";
  return null;
}

/** Dónde se conecta: Mi cuenta → Conexiones (el Google Calendar propio de cada persona, sin permisos de agenda). */
export const CONNECT_GOOGLE_HREF = "/dashboard/cuenta?tab=conexiones";

export const NO_GOOGLE_TITLE = "No tenés Google Calendar conectado";
export const NO_GOOGLE_BODY =
  "La agenda funciona igual, pero tus reuniones quedan solo en el sistema: no se crean en Google, no llevan link de Meet y tu disponibilidad no ve tus compromisos personales.";
export const BROKEN_GOOGLE_TITLE = "Tu Google Calendar está desconectado";
export const BROKEN_GOOGLE_BODY = "Hasta que lo reconectes, tus eventos no ofrecen horarios.";

/** Lo mismo, dicho de otra persona (quien mira la disponibilidad de alguien del equipo). Sin botón: conecta ella. */
export function otherPersonNotice(state: Exclude<GoogleCalendarState, "connected">, name: string): { title: string; body: string } {
  return state === "broken"
    ? { title: `El Google Calendar de ${name} está desconectado`, body: "Hasta que lo reconecte desde Mi cuenta, sus eventos no ofrecen horarios." }
    : {
        title: `${name} no tiene Google Calendar conectado`,
        body: "Sus reuniones quedan solo en el sistema (sin Google ni Meet) y su disponibilidad no ve sus compromisos personales. Lo conecta desde Mi cuenta → Conexiones.",
      };
}
