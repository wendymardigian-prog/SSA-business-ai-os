/**
 * Cómo se lee cada estado y cada motivo de la cola en la pantalla. PURO.
 * Colores de estado: solo verde, amarillo y rojo; lo que no es un estado de alarma va neutro (sin color).
 */
import type { SendQueueStatus } from "@/lib/types/database";

export type QueueTone = "green" | "yellow" | "red" | "neutral";

export const STATUS_LABELS: Record<SendQueueStatus, string> = {
  scheduled: "Programado",
  queued: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  failed: "Fallido",
  overdue: "Vencido",
  expired: "Caducado",
  discarded: "Descartado",
};

export const STATUS_TONES: Record<SendQueueStatus, QueueTone> = {
  scheduled: "neutral",
  queued: "neutral",
  sending: "green",
  sent: "green",
  failed: "red",
  overdue: "yellow",
  expired: "red",
  discarded: "yellow",
};

/** Las pestañas de la pantalla, en orden; «Pendientes» junta lo programado y lo que espera turno. */
export const STATUS_TABS = [
  { key: "pendientes", label: "Pendientes", statuses: ["scheduled", "queued"] },
  { key: "enviando", label: "Enviando", statuses: ["sending"] },
  { key: "enviados", label: "Enviados", statuses: ["sent"] },
  { key: "fallidos", label: "Fallidos", statuses: ["failed"] },
  { key: "caducados", label: "Caducados", statuses: ["expired"] },
  { key: "vencidos", label: "Vencidos", statuses: ["overdue"] },
  { key: "descartados", label: "Descartados", statuses: ["discarded"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; statuses: readonly SendQueueStatus[] }>;

export type StatusTabKey = (typeof STATUS_TABS)[number]["key"];

export function parseStatusTab(raw: unknown): StatusTabKey {
  return STATUS_TABS.some((t) => t.key === raw) ? (raw as StatusTabKey) : "pendientes";
}

/** Los motivos con nombre propio (`reason_code`). */
export const REASON_LABELS: Record<string, string> = {
  expired: "Caducó sin salir",
  quota_urgent: "Cupo de urgentes agotado",
  contact_cap: "Tope del contacto hoy",
  lane_paused: "Número pausado",
  emptied: "Se vació la cola",
  do_not_contact: "Contacto «no contactar»",
  overdue: "Ya tendría que haber salido",
  rejected: "Lo rechazó el destinatario",
  transport: "Fallo de conexión",
  stale: "Se interrumpió a mitad del envío",
  no_whatsapp: "El número no tiene WhatsApp",
  no_target: "Sin destino",
  waiting_quota: "Esperando cupo",
};

/** El estado como lo ve una persona: «Esperando cupo» si espera por el cupo de la hora. */
export function displayStatus(status: SendQueueStatus, reasonCode: string | null): { label: string; tone: QueueTone } {
  if (status === "queued" && reasonCode === "waiting_quota") return { label: "Esperando cupo", tone: "yellow" };
  if (status === "discarded" && reasonCode === "contact_cap") return { label: "Descartado por tope", tone: "yellow" };
  return { label: STATUS_LABELS[status], tone: STATUS_TONES[status] };
}

export const TONE_CLASS: Record<QueueTone, string> = {
  green: "border-green-600/30 bg-green-600/10 text-green-800 dark:text-green-300",
  yellow: "border-yellow-500/40 bg-yellow-400/15 text-yellow-900 dark:text-yellow-200",
  red: "border-red-600/30 bg-red-600/10 text-red-800 dark:text-red-300",
  neutral: "border-border bg-muted/60 text-foreground",
};
