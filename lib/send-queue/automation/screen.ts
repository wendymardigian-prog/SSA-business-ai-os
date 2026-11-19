/**
 * Lo que muestra la pantalla «Cola de mensajes», armado a partir de datos ya leídos. PURO.
 * Colores de estado: solo verde, amarillo y rojo (o neutro).
 */
import type { SendQueuePriority, SendQueueStatus, SendQueueTargetKind } from "@/lib/types/database";
import { describeDays } from "@/lib/send-queue/pace";
import type { LaneAlertSettings } from "./lane-alert";
import type { QueueTone, StatusTabKey } from "./labels";
import type { QueuePolicy, WarmupStep } from "./policy";
import { hourlyLimitFor } from "./quota";
import type { ContactCapPolicy } from "./contact-cap";

export interface LaneCardInput {
  channelId: string;
  name: string;
  sessionDown: boolean;
  pausedAt: string | null;
  pausedReason: string | null;
  bulkPausedAt: string | null;
  nextSendAt: string | null;
  /** El ritmo que vale ahora (con el calentamiento aplicado). */
  policy: QueuePolicy;
  /** «calentando: día 3 de 7, cupos al 50 %» (null = ya calentó). */
  warmupLabel: string | null;
  /** La escalera que vale (la guardada o la de un tramo). */
  warmupSteps: WarmupStep[];
  lastHour: number;
  today: number;
  pending: number;
  /** Ahora es horario de envío del número. */
  inHours: boolean;
  /** La próxima apertura, ya formateada en la zona de quien mira: «a las 08:00» o «el 16/11 a las 08:00». */
  opensAtLabel: string | null;
}

export interface LaneCard {
  channelId: string;
  name: string;
  subtitle: string;
  status: { label: string; tone: QueueTone };
  hour: { used: number; limit: number | null; pct: number | null };
  day: { used: number; limit: number | null; pct: number | null };
  paceText: string;
  windowText: string;
  note: string | null;
  paused: boolean;
  bulkPaused: boolean;
  pending: number;
  warming: boolean;
  warmupSteps: WarmupStep[];
  nextSendAt: string | null;
  gap: { min: number; max: number };
}

const pctOf = (used: number, limit: number | null) => (limit === null || limit <= 0 ? null : Math.min(100, Math.round((used / limit) * 100)));

export function laneCard(i: LaneCardInput): LaneCard {
  const hourLimit = i.policy.perHour;
  const dayLimit = i.policy.perDay;
  const normalLimit = hourlyLimitFor(i.policy, "normal");
  let status: LaneCard["status"];
  let note: string | null = null;
  if (i.pausedAt) {
    status = { label: "Pausado", tone: "red" };
    note = i.pausedReason ?? "Pausado a mano.";
  } else if (i.sessionDown) {
    status = { label: "Sesión caída", tone: "red" };
    note = "Reconectá el número en Canales.";
  } else if (i.pending > 0 && (!i.inHours || (normalLimit !== null && i.lastHour >= normalLimit) || (dayLimit !== null && i.today >= dayLimit))) {
    status = { label: "En espera", tone: "yellow" };
    note = !i.inHours ? (i.opensAtLabel ? `Fuera del horario de envío: sigue ${i.opensAtLabel}.` : "Fuera del horario de envío.") : "Esperando cupo.";
  } else if (i.pending > 0) {
    status = { label: "Enviando", tone: "green" };
  } else {
    status = { label: "Sin cola", tone: "neutral" };
  }
  const w = i.policy.window;
  return {
    channelId: i.channelId,
    name: i.name,
    subtitle: [i.warmupLabel, i.bulkPausedAt ? "masivo pausado" : null].filter(Boolean).join(" · "),
    status,
    hour: { used: i.lastHour, limit: hourLimit, pct: pctOf(i.lastHour, hourLimit) },
    day: { used: i.today, limit: dayLimit, pct: pctOf(i.today, dayLimit) },
    paceText: `${i.policy.minGapSeconds}–${i.policy.maxGapSeconds} s entre mensajes · reserva ${i.policy.urgentReservePct} % para urgentes`,
    windowText: w.enabled ? `${describeDays(w.days)} de ${w.start} a ${w.end}` : "a cualquier hora",
    note,
    paused: i.pausedAt !== null,
    bulkPaused: i.bulkPausedAt !== null,
    pending: i.pending,
    warming: i.warmupLabel !== null,
    warmupSteps: i.warmupSteps,
    nextSendAt: i.nextSendAt,
    gap: { min: i.policy.minGapSeconds, max: i.policy.maxGapSeconds },
  };
}

/**
 * La línea junto a las pestañas: «Siguiente envío en 12 s · se reparten con 25 a 60 s entre uno y otro». El próximo
 * envío es el más cercano de los números que están enviando (ni pausados ni en espera); sin ninguno, solo el reparto.
 * Sin números, null.
 */
export function queueTimingText(cards: Array<Pick<LaneCard, "status" | "paused" | "pending" | "nextSendAt" | "gap">>, nowMs: number): string | null {
  if (cards.length === 0) return null;
  const min = Math.min(...cards.map((c) => c.gap.min));
  const max = Math.max(...cards.map((c) => c.gap.max));
  const spread = `se reparten con ${min} a ${max} s entre uno y otro`;
  let next: number | null = null;
  for (const c of cards) {
    if (c.paused || c.pending === 0 || c.status.label !== "Enviando") continue;
    const at = c.nextSendAt ? Date.parse(c.nextSendAt) : nowMs;
    if (Number.isNaN(at)) continue;
    if (next === null || at < next) next = at;
  }
  if (next === null) return spread.charAt(0).toUpperCase() + spread.slice(1);
  const secs = Math.max(0, Math.round((next - nowMs) / 1000));
  const inText = secs < 60 ? `${secs} s` : `${Math.round(secs / 60)} min`;
  return `Siguiente envío en ${inText} · ${spread}`;
}

/** El aviso de la cabecera: el número con más cupo de la hora usado, si pasa del 80 %. */
export function busiestWarning(cards: Array<Pick<LaneCard, "hour" | "name">>): string | null {
  let worst: { pct: number; name: string } | null = null;
  for (const c of cards) {
    const pct = c.hour.pct;
    if (pct !== null && pct >= 80 && (!worst || pct > worst.pct)) worst = { pct, name: c.name };
  }
  return worst ? `Un número al ${worst.pct} % del cupo de la hora (${worst.name})` : null;
}

/** El color de una barra de cupo: verde, amarillo desde el 70 %, rojo desde el 90 %. */
export function barTone(pct: number | null): QueueTone {
  if (pct === null) return "neutral";
  if (pct >= 90) return "red";
  if (pct >= 70) return "yellow";
  return "green";
}

export interface QueueRow {
  id: string;
  channelId: string;
  channelName: string;
  status: SendQueueStatus;
  reasonCode: string | null;
  reason: string | null;
  priority: SendQueuePriority;
  preview: string | null;
  clientLabel: string | null;
  targetKind: SendQueueTargetKind;
  scheduledFor: string;
  expiresAt: string | null;
  sentAt: string | null;
  attempts: number;
  flowId: string | null;
  flowName: string | null;
}

export interface QueueScreen {
  /** El momento en que se armó la pantalla (el componente no lee el reloj mientras dibuja). */
  nowMs: number;
  cards: LaneCard[];
  tabs: Array<{ key: StatusTabKey; label: string; count: number }>;
  rows: QueueRow[];
  /** Hay más filas de las que se muestran. */
  truncated: boolean;
  totalPending: number;
  today: { sent: number; failed: number; expired: number; overdue: number; discarded: number };
  channels: Array<{ id: string; name: string }>;
  contactCap: ContactCapPolicy;
  laneAlert: LaneAlertSettings;
}
