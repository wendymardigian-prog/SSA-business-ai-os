/**
 * Cambiar el anfitrion de un evento: las reglas, sin base ni pantalla. PURO.
 *
 * El cambio en si lo hace `change_event_type_host` (00290), en una transaccion;
 * aca vive a quien se le puede pasar, que frena el cambio y que se le avisa a la
 * persona antes de confirmar.
 */
import type { ChecklistItem } from "@/lib/scheduling/event-validation";
import type { NotBookableReason } from "@/lib/scheduling/bookable";

export interface HostCandidate {
  userId: string;
  label: string;
  username: string | null;
  isActive: boolean;
  hasGoogle: boolean;
}

export function hostCandidates(
  members: { userId: string; name: string; email: string }[],
  profiles: { user_id: string; username: string; is_active: boolean }[],
  googleUserIds: Iterable<string>,
): HostCandidate[] {
  const byUser = new Map(profiles.map((p) => [p.user_id, p]));
  const withGoogle = new Set(googleUserIds);
  return members
    .map((m) => {
      const profile = byUser.get(m.userId);
      return {
        userId: m.userId,
        label: m.name || m.email,
        username: profile?.username ?? null,
        isActive: profile?.is_active ?? false,
        hasGoogle: withGoogle.has(m.userId),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

/** Sin perfil no tiene link ni horario: todavia no se le puede pasar un evento. */
export function canPickHost(candidate: HostCandidate): boolean {
  return candidate.username !== null;
}

export function hostOptionLabel(candidate: HostCandidate): string {
  if (!candidate.username) return `${candidate.label} (sin perfil de agenda)`;
  if (!candidate.isActive) return `${candidate.label} (agenda desactivada)`;
  if (!candidate.hasGoogle) return `${candidate.label} (sin Google Calendar)`;
  return candidate.label;
}

/**
 * Lo que impide pasarle un evento que ya recibe reuniones. Sin este freno, el link
 * publico dejaria de ofrecer horarios sin que nadie se entere. Un evento inactivo
 * pasa siempre: su chequeo "Listo para activar" dice que falta.
 */
export function hostChangeBlocker(input: {
  hostName: string;
  eventStatus: string;
  notBookable: NotBookableReason | null;
  checklist: Pick<ChecklistItem, "key" | "required" | "ok">[];
}): string | null {
  if (input.eventStatus === "inactive") return null;
  const hint = "Resolvelo primero o desactivá el evento antes de cambiarlo.";
  if (input.notBookable === "no_profile") return `${input.hostName} todavía no configuró su agenda. ${hint}`;
  if (input.notBookable === "profile_inactive") return `${input.hostName} tiene la agenda desactivada. ${hint}`;
  if (input.notBookable === "calendar_disconnected") return `${input.hostName} tiene su Google Calendar desconectado: su link dejaría de ofrecer horarios. ${hint}`;

  const missing = (key: string) => input.checklist.some((item) => item.key === key && item.required && !item.ok);
  if (missing("schedule")) return `${input.hostName} no tiene un horario por defecto. ${hint}`;
  if (missing("calendar")) return `Este evento usa Google Meet y ${input.hostName} no tiene un Google Calendar donde crear el link. ${hint}`;
  return null;
}

/** El aviso antes de confirmar: lo que cambia y lo que no. */
export function hostChangeMessage(input: {
  eventTitle: string;
  hostName: string;
  hasGoogle: boolean;
  futureBookings: number;
  newLink: string;
}): string {
  const parts = [
    `Las reuniones nuevas de «${input.eventTitle}» se van a agendar con ${input.hostName}, con su horario y sus calendarios por defecto.`,
  ];
  if (input.futureBookings === 1) {
    parts.push("La reunión que ya está agendada se queda con quien la tiene; se puede reasignar desde su panel.");
  } else if (input.futureBookings > 1) {
    parts.push(`Las ${input.futureBookings} reuniones que ya están agendadas se quedan con quien las tiene; cada una se puede reasignar desde su panel.`);
  }
  if (!input.hasGoogle) parts.push(`${input.hostName} no tiene Google Calendar: las reuniones van a quedar solo en el sistema.`);
  parts.push(`El link pasa a ser ${input.newLink}. El anterior sigue funcionando.`);
  return parts.join(" ");
}

/** Lo que devuelve la base, en lo que tiene que leer la persona. */
export function hostChangeError(status: string, hostName: string, slug: string): string {
  switch (status) {
    case "slug_taken":
      return `${hostName} ya tiene un evento con el link «${slug}». Cambiale el link a este evento y volvé a intentarlo.`;
    case "stale":
      return "Alguien más cambió el anfitrión de este evento. Recargá la página y volvé a intentarlo.";
    case "same_host":
      return `${hostName} ya es el anfitrión de este evento.`;
    case "no_profile":
      return `${hostName} todavía no configuró su agenda.`;
    case "not_member":
      return "No encontré a esa persona en el equipo.";
    case "not_found":
      return "No encontré ese evento.";
    default:
      return "No pude cambiar el anfitrión. Probá de nuevo en un rato.";
  }
}
