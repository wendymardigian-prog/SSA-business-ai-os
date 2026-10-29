/**
 * La suscripcion a emails en la importacion por CSV (E6). Puro: lo usan el mapeo,
 * la prueba en seco, la importacion y sus tests.
 *
 * Cuatro columnas que se pueden mapear: "Suscripcion a emails", "Fecha de baja",
 * "Motivo de la baja" y "Fecha de suscripcion". Con eso, cada fila trae el estado
 * que tenia la persona en el otro sistema. Reglas:
 *  1. Varias filas con el mismo email se consolidan ANTES de escribir: gana el
 *     estado mas grave (con la fecha de esa fila) y la fecha de suscripcion mas
 *     vieja (`consolidateSubscriptions`).
 *  2. Todo se escribe con `set_email_status` en modo `system`: si el contacto ya
 *     existia, el archivo solo cuenta si es igual o mas grave. Nunca re-suscribe.
 *  3. Sin la columna de suscripcion mapeada, no se toca el estado.
 */

import {
  emailStatusRank,
  mapUnsubscribeSource,
  normalizeEmailAddress,
  parseImportSubscription,
  type EmailStatus,
} from "@/lib/email/subscription";
import { normalizeCustomValue } from "@/lib/custom-fields";

export const SUBSCRIPTION_TARGETS = ["sub:status", "sub:unsubscribed_at", "sub:unsubscribe_source", "sub:subscribed_at"] as const;
export type SubscriptionTarget = (typeof SUBSCRIPTION_TARGETS)[number];

export const SUBSCRIPTION_TARGET_LABELS: Record<SubscriptionTarget, string> = {
  "sub:status": "Suscripción a emails",
  "sub:unsubscribed_at": "Fecha de baja",
  "sub:unsubscribe_source": "Motivo de la baja",
  "sub:subscribed_at": "Fecha de suscripción",
};

export function isSubscriptionTarget(target: string): target is SubscriptionTarget {
  return (SUBSCRIPTION_TARGETS as readonly string[]).includes(target);
}

/** Lo que dice una fila sobre la suscripcion, ya validado. */
export interface RowSubscription {
  status: EmailStatus;
  /** Cuando paso al estado (ISO). Una baja: la fecha de baja. */
  at: string | null;
  /** Cuando dio el consentimiento (ISO). */
  subscribedAt: string | null;
  /** El motivo tal como venia del otro sistema (`email_footer`, `bounce`...), para el historial. */
  originalSource: string | null;
}

const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Una fecha de la planilla. Con hora (`2025-03-04 15:22:11+00`, ISO) se respeta
 * el instante; solo el dia (`2025-03-04`, `04/03/2025`) va a las 12:00 UTC (asi el
 * dia no se corre en ninguna zona). No puede ser futura.
 */
export function parseImportTimestamp(raw: string, now: Date = new Date()): { ok: true; value: string } | { ok: false } {
  const text = raw.trim();
  const m = DATETIME.exec(text);
  let date: Date | null = null;
  if (m) {
    const zone = m[7] ? (m[7].toUpperCase() === "Z" ? "Z" : m[7].length === 3 ? `${m[7]}:00` : m[7].includes(":") ? m[7] : `${m[7].slice(0, 3)}:${m[7].slice(3)}`) : "Z";
    date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${zone}`);
  } else {
    const day = normalizeCustomValue("date", text);
    if (day.ok) date = new Date(`${day.value}T12:00:00.000Z`);
  }
  if (!date || Number.isNaN(date.getTime())) return { ok: false };
  if (date.getTime() > now.getTime() + 60_000) return { ok: false };
  return { ok: true, value: date.toISOString() };
}

export interface RawSubscriptionCells {
  status?: string;
  unsubscribedAt?: string;
  unsubscribeSource?: string;
  subscribedAt?: string;
}

/**
 * La suscripcion de una fila. `statusMapped`: el archivo trae la columna de
 * suscripcion (si no, la fila no dice nada y el estado no se toca).
 */
export function rowSubscription(
  cells: RawSubscriptionCells,
  statusMapped: boolean,
  now: Date = new Date(),
): { ok: true; value: RowSubscription | null } | { ok: false; error: string } {
  if (!statusMapped) return { ok: true, value: null };
  const raw = (cells.status ?? "").trim();
  const fromColumn = parseImportSubscription(raw);
  if (!fromColumn) {
    return { ok: false, error: raw ? `«${raw}» no es un estado de suscripción válido` : "Falta el estado de suscripción a emails" };
  }

  // El motivo de la baja puede decir mas que la columna: "false" + "bounce" es un rebote.
  const source = mapUnsubscribeSource(cells.unsubscribeSource);
  let status: EmailStatus = fromColumn;
  if (fromColumn !== "subscribed" && source && emailStatusRank(source.status) > emailStatusRank(status)) status = source.status;

  let at: string | null = null;
  if (cells.unsubscribedAt?.trim()) {
    const parsed = parseImportTimestamp(cells.unsubscribedAt, now);
    if (!parsed.ok) return { ok: false, error: `La fecha de baja «${cells.unsubscribedAt.trim()}» no es válida o es futura` };
    at = parsed.value;
  }
  let subscribedAt: string | null = null;
  if (cells.subscribedAt?.trim()) {
    const parsed = parseImportTimestamp(cells.subscribedAt, now);
    if (!parsed.ok) return { ok: false, error: `La fecha de suscripción «${cells.subscribedAt.trim()}» no es válida o es futura` };
    subscribedAt = parsed.value;
  }

  return {
    ok: true,
    value: {
      status,
      // Una baja usa su fecha; un suscripto, la de su consentimiento.
      at: status === "subscribed" ? subscribedAt : at,
      subscribedAt,
      originalSource: status === "subscribed" ? null : (source?.original ?? null),
    },
  };
}

/** La mas vieja de dos fechas ISO (null = sin dato). */
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Junta dos lecturas de la misma direccion: gana el estado mas grave (con su fecha y
 * su motivo), y el consentimiento mas viejo. Conmutativa: el orden de las filas no
 * cambia el resultado (empatados, la fecha mas vieja).
 */
export function mergeSubscriptions(a: RowSubscription, b: RowSubscription): RowSubscription {
  const ra = emailStatusRank(a.status);
  const rb = emailStatusRank(b.status);
  const winner = ra > rb ? a : rb > ra ? b : (a.at ?? "") <= (b.at ?? "") ? a : b;
  return { ...winner, at: ra === rb ? earliest(a.at, b.at) : winner.at, subscribedAt: earliest(a.subscribedAt, b.subscribedAt) };
}

/** Lo que el consolidado necesita de cada fila valida. */
export interface SubscriptionRowRef {
  line: number;
  email: string | null;
  subscription: RowSubscription | null;
}

/**
 * Consolida por direccion (sin importar mayusculas) todo el archivo: el resultado de
 * cada email y cuantas filas se juntaron con otra (las que repiten un email).
 */
export function consolidateSubscriptions(rows: SubscriptionRowRef[]): { byEmail: Record<string, RowSubscription>; consolidatedRows: number } {
  const byEmail: Record<string, RowSubscription> = {};
  const count: Record<string, number> = {};
  for (const row of rows) {
    const email = normalizeEmailAddress(row.email);
    if (!email || !row.subscription) continue;
    count[email] = (count[email] ?? 0) + 1;
    byEmail[email] = byEmail[email] ? mergeSubscriptions(byEmail[email], row.subscription) : row.subscription;
  }
  const consolidatedRows = Object.values(count).reduce((sum, n) => sum + (n > 1 ? n - 1 : 0), 0);
  return { byEmail, consolidatedRows };
}

/**
 * Lo que se aplica a una fila: lo suyo, junto con lo consolidado de su email si vino.
 * El consolidado solo puede empeorar el estado (asi un pedido armado a mano no puede
 * re-suscribir a nadie).
 */
export function effectiveRowSubscription(own: RowSubscription | null, consolidated: RowSubscription | null | undefined): RowSubscription | null {
  if (!own) return null;
  return consolidated ? mergeSubscriptions(own, consolidated) : own;
}

/** Valida lo consolidado que manda el navegador (forma y estados); lo invalido se descarta. */
export function parseConsolidated(raw: unknown): Record<string, RowSubscription> {
  const out: Record<string, RowSubscription> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [email, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeEmailAddress(email);
    const v = value as Partial<RowSubscription> | null;
    if (!key || !v || typeof v !== "object") continue;
    if (v.status !== "subscribed" && v.status !== "unsubscribed" && v.status !== "bounced" && v.status !== "complained") continue;
    const iso = (x: unknown) => (typeof x === "string" && !Number.isNaN(Date.parse(x)) ? new Date(x).toISOString() : null);
    out[key] = {
      status: v.status,
      at: iso(v.at),
      subscribedAt: iso(v.subscribedAt),
      originalSource: typeof v.originalSource === "string" ? v.originalSource.slice(0, 60) : null,
    };
  }
  return out;
}

/** El origen de la importacion: lo que va en `import:<origen>` y en la etiqueta `origen:<origen>`. */
export function importOriginSlug(raw: string | null | undefined): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Los totales de suscripcion de una importacion (por persona, no por fila). */
export interface SubscriptionTotals {
  subscribed: number;
  unsubscribed: number;
  bounced: number;
  complained: number;
  /** Contactos que ya existian y el archivo decia suscripto: no se re-suscribieron (la baja gana). */
  notResubscribed: number;
}

/** El resultado de una fila para los totales: a que persona fue a parar y como quedo. */
export interface SubscriptionOutcome {
  /** El contacto (o, en la prueba en seco, la persona que se crearia). */
  key: string;
  status: EmailStatus;
  keptExisting: boolean;
}

/** Cuenta por persona: varias filas de la misma persona cuentan una vez. */
export function subscriptionTotals(outcomes: SubscriptionOutcome[]): SubscriptionTotals {
  const byKey = new Map<string, { status: EmailStatus; kept: boolean }>();
  for (const o of outcomes) {
    const prev = byKey.get(o.key);
    const status = prev && emailStatusRank(prev.status) > emailStatusRank(o.status) ? prev.status : o.status;
    byKey.set(o.key, { status, kept: (prev?.kept ?? false) || o.keptExisting });
  }
  const totals: SubscriptionTotals = { subscribed: 0, unsubscribed: 0, bounced: 0, complained: 0, notResubscribed: 0 };
  for (const { status, kept } of byKey.values()) {
    totals[status]++;
    if (kept) totals.notResubscribed++;
  }
  return totals;
}
