import type {
  SequenceEnrollmentStatus,
  SequenceStatus,
} from "@/lib/types/database";

/**
 * Como se nombran los estados de una secuencia en la UI.
 *
 * Vive aparte de los componentes porque lo usan la lista, el detalle y la
 * ficha del contacto, y porque el diccionario incompleto era un bug real: la
 * lista de inscriptos no tenia entrada para "paused", asi que una inscripcion
 * pausada por opt-out rompia la pantalla al leer .classes de undefined.
 */

export interface StatusStyle {
  label: string;
  classes: string;
}

const NEUTRAL = "bg-muted text-muted-foreground";
const GREEN = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
const AMBER = "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
const BLUE = "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";

export const SEQUENCE_STATUS: Record<SequenceStatus, StatusStyle> = {
  draft: { label: "Borrador", classes: NEUTRAL },
  active: { label: "Activa", classes: GREEN },
  paused: { label: "Pausada", classes: AMBER },
};

export const ENROLLMENT_STATUS: Record<SequenceEnrollmentStatus, StatusStyle> = {
  active: { label: "Activa", classes: GREEN },
  paused: { label: "Pausada", classes: AMBER },
  completed: { label: "Completada", classes: BLUE },
  cancelled: { label: "Cancelada", classes: NEUTRAL },
};

/** Por que se freno, dicho para una persona. */
const PAUSE_REASONS: Record<string, string> = {
  contact_replied: "el contacto respondió",
  opt_out: "pidió no ser contactado",
  known: "es un conocido",
  customer: "es un cliente",
  sequence_paused: "se pausó la secuencia",
  no_conversation: "no hay una conversación abierta",
  collision: "estaba en más de una secuencia",
  // Suscripcion a emails (00271): se pausa en el momento de la baja y no se reanuda sola.
  email_unsubscribed: "se dio de baja de los emails",
  email_bounced: "el email rebota",
  email_complained: "marcó el email como spam",
};

/** Los motivos de pausa por la suscripcion a emails (para distinguirlos de "no contactar" y filtrar). */
export const EMAIL_PAUSE_REASON_KEYS = ["email_unsubscribed", "email_bounced", "email_complained"] as const;

export function isEmailPause(reason: string | null | undefined): boolean {
  return !!reason && (EMAIL_PAUSE_REASON_KEYS as readonly string[]).includes(reason);
}

/** El grupo de una pausa, para el filtro de la pantalla de la secuencia. */
export type PauseGroup = "email" | "opt_out" | "other";

export function pauseGroup(reason: string | null | undefined): PauseGroup {
  if (isEmailPause(reason)) return "email";
  if (reason === "opt_out") return "opt_out";
  return "other";
}

export function pauseReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return PAUSE_REASONS[reason] ?? null;
}

/**
 * Se puede reanudar a mano?
 *
 * El opt-out no: volver a escribirle a alguien que pidio que no lo contacten
 * tiene que ser una decision explicita, y se hace re-inscribiendolo.
 */
export function isResumable(
  status: SequenceEnrollmentStatus,
  reason: string | null | undefined
): boolean {
  return status === "paused" && reason !== "opt_out";
}

export function sequenceStatusStyle(status: string): StatusStyle {
  return SEQUENCE_STATUS[status as SequenceStatus] ?? SEQUENCE_STATUS.draft;
}

export function enrollmentStatusStyle(status: string): StatusStyle {
  return ENROLLMENT_STATUS[status as SequenceEnrollmentStatus] ?? ENROLLMENT_STATUS.cancelled;
}

const STEP_LABELS: Record<string, string> = {
  message: "Mensaje",
  delay: "Espera",
  aiMessage: "Mensaje con IA",
  asset: "Recurso",
};

export function stepTypeLabel(type: string): string {
  return STEP_LABELS[type] ?? type;
}

/** "3 pasos" / "1 paso". */
export function stepCountLabel(count: number): string {
  return `${count} ${count === 1 ? "paso" : "pasos"}`;
}
