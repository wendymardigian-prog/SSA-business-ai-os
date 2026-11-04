/** Cómo se muestra cada estado de un broadcast y de un destinatario. Puro. */
import type { BroadcastRecipientStatus, BroadcastStatus } from "@/lib/types/database";
import { SKIP_REASON_LABELS, type SendSkipReason } from "./audience";

export const BROADCAST_STATUS: Record<BroadcastStatus, { label: string; tone: "muted" | "info" | "warn" | "ok" | "bad" }> = {
  draft: { label: "Borrador", tone: "muted" },
  scheduled: { label: "Programado", tone: "info" },
  sending: { label: "Enviando", tone: "warn" },
  paused: { label: "Pausado", tone: "muted" },
  completed: { label: "Terminado", tone: "ok" },
  cancelled: { label: "Cancelado", tone: "bad" },
};

export const RECIPIENT_STATUS: Record<BroadcastRecipientStatus, string> = {
  pending: "En cola",
  sending: "Saliendo",
  sent: "Enviado",
  failed: "Falló",
  skipped: "Salteado",
  cancelled: "Cancelado",
};

export const TONE_CLASS: Record<"muted" | "info" | "warn" | "ok" | "bad", string> = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  ok: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  bad: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

export function isBroadcastStatus(v: unknown): v is BroadcastStatus {
  return typeof v === "string" && v in BROADCAST_STATUS;
}

/** El motivo de un salteado o un fallo, para leer. */
export function recipientReason(skipReason: string | null, error: string | null): string | null {
  if (skipReason && skipReason in SKIP_REASON_LABELS) return SKIP_REASON_LABELS[skipReason as SendSkipReason];
  return error;
}

/** Una fecha con día de la semana y hora, en la zona del negocio. */
export function formatEta(d: Date, timeZone: string): string {
  return d.toLocaleString("es", { timeZone, weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
