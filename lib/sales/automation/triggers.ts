/**
 * Los seis triggers de Ventas y sus filtros (plano F37), como funciones puras.
 *
 * El registro (`lib/flow-engine/registry/sales-triggers.ts`) los declara; la lógica de
 * «¿este evento le corresponde a este trigger?» vive acá para probarla sin base ni cron.
 *
 *   sale_created            Se crea una venta
 *   sale_status_changed     Cambia el estado de la venta (y al nacer: `from_status` ausente)
 *   payment_created         Se crea un pago (programado, cobrado o reembolso)
 *   payment_status_changed  Cambia el estado de un pago (y al nacer cobrado)
 *   payment_before_due      Relativo: X días ANTES del vencimiento
 *   payment_after_due       Relativo: X días DESPUÉS del vencimiento, si sigue impago
 *
 * Reglas que valen para todos:
 *  - Vacío significa «cualquiera», nunca «ninguno».
 *  - Una configuración ROTA no dispara para nadie (al revés que un vacío): es más seguro que mandar a todos.
 *  - Los filtros leen el PAYLOAD del evento (solo escalares); nunca la venta de hoy.
 *  - Un cambio = un evento. Los atajos («Pago cobrado») son presets del editor, no tipos aparte.
 */
import { z } from "zod";
import { wallClockToUtc } from "@/lib/scheduling/time/tz";
import { addDays, isDateOnly } from "../dates";
import { ATTRIBUTION_TYPES, FINANCING_TYPES, PAYMENT_STATUSES, PAYMENT_TYPES, SALE_STATUSES } from "../labels";

export const SALES_TRIGGER_TYPES = [
  "sale_created",
  "sale_status_changed",
  "payment_created",
  "payment_status_changed",
  "payment_before_due",
  "payment_after_due",
] as const;
export type SalesTriggerType = (typeof SALES_TRIGGER_TYPES)[number];

export const SALES_TRIGGER_LABELS: Record<SalesTriggerType, string> = {
  sale_created: "Venta creada",
  sale_status_changed: "Cambió el estado de la venta",
  payment_created: "Pago creado",
  payment_status_changed: "Cambió el estado del pago",
  payment_before_due: "X días antes de un vencimiento",
  payment_after_due: "X días después de un vencimiento impago",
};

export const RELATIVE_SALES_TRIGGERS: readonly SalesTriggerType[] = ["payment_before_due", "payment_after_due"];

export function isSalesTriggerType(value: unknown): value is SalesTriggerType {
  return typeof value === "string" && (SALES_TRIGGER_TYPES as readonly string[]).includes(value);
}

export function isRelativeSalesTrigger(type: string): boolean {
  return (RELATIVE_SALES_TRIGGERS as readonly string[]).includes(type);
}

/** El trigger atiende el evento del MISMO nombre. */
export const EVENT_TYPES_OF: Record<SalesTriggerType, string[]> = {
  sale_created: ["sale_created"],
  sale_status_changed: ["sale_status_changed"],
  payment_created: ["payment_created"],
  payment_status_changed: ["payment_status_changed"],
  payment_before_due: ["payment_before_due"],
  payment_after_due: ["payment_after_due"],
};

// ── La configuración ────────────────────────────────────────────────────

const ids = z.array(z.string().min(1).max(64)).max(100);
const oneOf = <T extends readonly [string, ...string[]]>(values: T) => z.array(z.enum(values)).max(20);
const amount = z.coerce.number().finite().min(-10_000_000).max(10_000_000);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "La hora tiene que ser HH:MM");

const saleFilters = {
  product_ids: ids.optional(),
  variant_ids: ids.optional(),
  utm_sources: ids.optional(),
  utm_mediums: ids.optional(),
  utm_campaign_contains: z.string().max(120).optional(),
  attribution_types: oneOf(ATTRIBUTION_TYPES).optional(),
  vendedor_ids: ids.optional(),
  setter_ids: ids.optional(),
  financing_types: oneOf(FINANCING_TYPES).optional(),
  min_amount: amount.optional(),
  max_amount: amount.optional(),
};

export const SALES_CONFIG_SCHEMAS = {
  sale_created: z.object(saleFilters).strip(),
  sale_status_changed: z
    .object({
      from_status: oneOf(SALE_STATUSES).optional(),
      to_status: oneOf(SALE_STATUSES).optional(),
      product_ids: ids.optional(),
      vendedor_ids: ids.optional(),
      utm_sources: ids.optional(),
      utm_mediums: ids.optional(),
      utm_campaign_contains: z.string().max(120).optional(),
      reasons_contains: z.string().max(120).optional(),
    })
    .strip(),
  payment_created: z
    .object({
      payment_types: oneOf(PAYMENT_TYPES).optional(),
      // Los métodos los crea el negocio (Extra I): la clave es un slug, no una lista fija.
      payment_methods: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(20).optional(),
      refund_scope: z.array(z.enum(["total", "partial"])).max(2).optional(),
      product_ids: ids.optional(),
    })
    .strip(),
  payment_status_changed: z
    .object({
      from_status: oneOf(PAYMENT_STATUSES).optional(),
      to_status: oneOf(PAYMENT_STATUSES).optional(),
      payment_types: oneOf(PAYMENT_TYPES).optional(),
      // Los métodos los crea el negocio (Extra I): la clave es un slug, no una lista fija.
      payment_methods: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(20).optional(),
      min_amount: amount.optional(),
      max_amount: amount.optional(),
      min_delay_days: z.coerce.number().int().min(-3650).max(3650).optional(),
      product_ids: ids.optional(),
    })
    .strip(),
  payment_before_due: z
    .object({
      // El selector de la persona va de 1 a 30; 0 («el día del vencimiento») es solo de las plantillas.
      offset_days: z.coerce.number().int().min(0).max(30),
      at_time: time.optional(),
      payment_types: oneOf(PAYMENT_TYPES).optional(),
      product_ids: ids.optional(),
    })
    .strip(),
  payment_after_due: z
    .object({
      offset_days: z.coerce.number().int().min(1).max(90),
      at_time: time.optional(),
      payment_types: oneOf(PAYMENT_TYPES).optional(),
      product_ids: ids.optional(),
    })
    .strip(),
} as const;

export type SalesTriggerConfig = Record<string, unknown>;

export type ConfigCheck = { ok: true; config: SalesTriggerConfig } | { ok: false; error: string };

/** Valida y limpia la configuración de un trigger. Una rota devuelve el motivo. */
export function validateSalesTriggerConfig(type: string, config: unknown): ConfigCheck {
  if (!isSalesTriggerType(type)) return { ok: false, error: "Tipo de trigger desconocido" };
  const raw = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const parsed = SALES_CONFIG_SCHEMAS[type].safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "La configuración no es válida" };
  const out: SalesTriggerConfig = {};
  for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return { ok: true, config: out };
}

export const DEFAULT_AT_TIME = "09:00";

// ── Qué evento le corresponde a qué trigger ─────────────────────────────

/** Lo que traen los eventos (solo escalares). */
export type SalesEventPayload = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function listMatches(allowed: unknown, actual: unknown): boolean {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  const value = text(actual);
  return value !== null && allowed.includes(value);
}

function containsMatches(needle: unknown, actual: unknown): boolean {
  const n = text(needle);
  if (!n) return true;
  const value = text(actual);
  return value !== null && value.toLowerCase().includes(n.toLowerCase());
}

function rangeMatches(config: SalesTriggerConfig, actual: unknown, minKey = "min_amount", maxKey = "max_amount"): boolean {
  const min = num(config[minKey]);
  const max = num(config[maxKey]);
  if (min === null && max === null) return true;
  const value = num(actual);
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

/**
 * ¿Este evento le corresponde a este trigger? Con la configuración rota, nunca. Los relativos se
 * emiten con el id de SU trigger en el payload: solo ese los atiende.
 */
export function salesEventMatches(type: string, rawConfig: unknown, payload: SalesEventPayload, triggerId?: string): boolean {
  const checked = validateSalesTriggerConfig(type, rawConfig);
  if (!checked.ok) return false;
  const c = checked.config;

  switch (type as SalesTriggerType) {
    case "sale_created":
      return (
        listMatches(c.product_ids, payload.product_id) &&
        listMatches(c.variant_ids, payload.variant_id) &&
        listMatches(c.utm_sources, payload.utm_source) &&
        listMatches(c.utm_mediums, payload.utm_medium) &&
        containsMatches(c.utm_campaign_contains, payload.utm_campaign) &&
        listMatches(c.attribution_types, payload.attribution_type) &&
        listMatches(c.vendedor_ids, payload.vendedor_id) &&
        listMatches(c.setter_ids, payload.setter_id) &&
        listMatches(c.financing_types, payload.financing_type) &&
        rangeMatches(c, payload.final_amount)
      );
    case "sale_status_changed":
      return (
        listMatches(c.from_status, payload.from_status) &&
        listMatches(c.to_status, payload.to_status) &&
        listMatches(c.product_ids, payload.product_id) &&
        listMatches(c.vendedor_ids, payload.vendedor_id) &&
        listMatches(c.utm_sources, payload.utm_source) &&
        listMatches(c.utm_mediums, payload.utm_medium) &&
        containsMatches(c.utm_campaign_contains, payload.utm_campaign) &&
        containsMatches(c.reasons_contains, payload.reason)
      );
    case "payment_created":
      return (
        listMatches(c.payment_types, payload.payment_type) &&
        listMatches(c.payment_methods, payload.payment_method) &&
        listMatches(c.refund_scope, payload.refund_scope) &&
        listMatches(c.product_ids, payload.product_id)
      );
    case "payment_status_changed": {
      if (!listMatches(c.from_status, payload.from_status) || !listMatches(c.to_status, payload.to_status)) return false;
      if (!listMatches(c.payment_types, payload.payment_type) || !listMatches(c.payment_methods, payload.payment_method)) return false;
      if (!listMatches(c.product_ids, payload.product_id)) return false;
      if (!rangeMatches(c, payload.amount)) return false;
      const minDelay = num(c.min_delay_days);
      if (minDelay !== null) {
        const delay = num(payload.delay_days);
        if (delay === null || delay < minDelay) return false;
      }
      return true;
    }
    case "payment_before_due":
    case "payment_after_due":
      // El evento relativo lleva el id del trigger que lo agendó: otro trigger no lo atiende.
      return !!triggerId && payload.trigger_id === triggerId;
    default:
      return false;
  }
}

// ── Idempotencia ────────────────────────────────────────────────────────

/**
 * La clave de un disparo. `<tipo>:<change_id>`: un cambio = un disparo POR TRIGGER (no se copia la clave
 * de las agendas, que dispara una sola vez en toda la vida de la agenda). Los relativos, por pago y por
 * número de reprogramación: mover el vencimiento vuelve a habilitar el recordatorio.
 */
export function salesDedupeKey(type: string, payload: SalesEventPayload, eventId: string, triggerId?: string): string {
  if (isRelativeSalesTrigger(type)) {
    return `${type}:${text(payload.trigger_id) ?? triggerId ?? ""}:${text(payload.payment_id) ?? eventId}:${num(payload.reschedule_count) ?? 0}`;
  }
  return `${type}:${text(payload.change_id) ?? eventId}`;
}

// ── Un flujo corre UNA vez por cambio ───────────────────────────────────

export interface CanonicalCandidate {
  triggerId: string;
  /** La prioridad de la fila de `triggers`. */
  priority: number;
  eventId: string;
}

/**
 * Entre todos los pares (trigger, evento) que coinciden para un mismo flujo y un mismo cambio, gana el
 * de menor `(prioridad, trigger.id, event.id)`. Es determinista: no depende del orden en que el cron
 * procese los eventos. Solo ese par puede disparar.
 */
export function pickCanonicalTrigger(candidates: readonly CanonicalCandidate[]): CanonicalCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => a.priority - b.priority || (a.triggerId < b.triggerId ? -1 : a.triggerId > b.triggerId ? 1 : 0) || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
  )[0];
}

// ── Recordatorios relativos al vencimiento ──────────────────────────────

export interface RelativePayment {
  id: string;
  type: string;
  status: string;
  due_date: string | null;
  reschedule_count: number;
  product_id: string | null;
}

export interface TriggerForPlanning {
  id: string;
  type: string;
  config: unknown;
}

export interface PlannedPaymentJob {
  triggerId: string;
  triggerType: SalesTriggerType;
  runAt: string;
  dedupeKey: string;
}

/** Un pago «abierto»: el único que recibe recordatorios. */
export function isOpenPayment(p: Pick<RelativePayment, "status" | "type">): boolean {
  return (p.status === "scheduled" || p.status === "overdue") && p.type !== "refund";
}

/**
 * Los jobs de un pago: por cada trigger relativo activo que coincida, uno con `run_at` calculado en la
 * zona del workspace (`due_date ± offset_days` a la hora configurada). Si el momento ya pasó, no se crea.
 */
export function planPaymentRelativeJobs(payment: RelativePayment, triggers: readonly TriggerForPlanning[], timeZone: string, now: Date): PlannedPaymentJob[] {
  if (!isOpenPayment(payment) || !payment.due_date || !isDateOnly(payment.due_date)) return [];
  const planned: PlannedPaymentJob[] = [];
  for (const trigger of triggers) {
    if (!isRelativeSalesTrigger(trigger.type)) continue;
    const checked = validateSalesTriggerConfig(trigger.type, trigger.config);
    if (!checked.ok) continue;
    const c = checked.config;
    if (!listMatches(c.payment_types, payment.type) || !listMatches(c.product_ids, payment.product_id)) continue;

    const offset = Number(c.offset_days);
    const day = trigger.type === "payment_before_due" ? addDays(payment.due_date, -offset) : addDays(payment.due_date, offset);
    const at = typeof c.at_time === "string" ? c.at_time : DEFAULT_AT_TIME;
    const runAt = wallClockToUtc(day, at, timeZone);
    if (runAt.getTime() <= now.getTime()) continue;
    planned.push({
      triggerId: trigger.id,
      triggerType: trigger.type as SalesTriggerType,
      runAt: runAt.toISOString(),
      dedupeKey: `rel:${trigger.id}:${payment.id}:${payment.reschedule_count}`,
    });
  }
  return planned;
}
