/**
 * Lo que se muestra de la guardia de entrega (00287): la seccion «Entrega de marketing» de la tarjeta Resend y el aviso
 * rojo del webhook en el editor de broadcasts y en el paso «Enviar email». PURO (lo usan el servidor y el navegador):
 * no lee la base; recibe lo que ya se leyo.
 */

import type { ResendConnectionState } from "./resend-config";
import { BRAKE_REQUIRED_EVENTS } from "./resend-events";

/** Los escalones del calentamiento (copia de `WARMUP_STEPS`: este modulo no importa lo de servidor). */
export const WARMUP_STEP_CAPS = [100, 200, 400, 800] as const;
export const MAX_MARKETING_DAILY_CAP = 100_000;

export const BRAKE_WEBHOOK_WARNING = "Los rebotes y quejas no están llegando: el freno automático no puede funcionar.";

/**
 * Por que el freno no puede funcionar, o null si los rebotes y las quejas llegan. Solo dice lo que se sabe: un webhook
 * desactivado en Resend, uno sin `email.bounced` / `email.complained`, o ninguno conectado.
 */
export function brakeWebhookProblem(state: ResendConnectionState | null, opts: { secretSaved?: boolean | null } = {}): string | null {
  if (!state) return null;
  const { webhook } = state;
  if (webhook.disabled) return `${BRAKE_WEBHOOK_WARNING} El webhook está desactivado en Resend: activalo en resend.com/webhooks y tocá «Actualizar webhook».`;
  if (webhook.events.length > 0) {
    const missing = BRAKE_REQUIRED_EVENTS.filter((e) => !webhook.events.includes(e));
    if (missing.length > 0) return `${BRAKE_WEBHOOK_WARNING} Al webhook le faltan ${missing.join(" y ")}: tocá «Actualizar webhook» en Resend.`;
    return null;
  }
  // Sin eventos guardados: o nunca se conecto, o se creo a mano (no se sabe que eventos tiene).
  if (!webhook.id && opts.secretSaved === false) return `${BRAKE_WEBHOOK_WARNING} El webhook de Resend no está conectado.`;
  return null;
}

/** Lo que devuelve la base (`email_send_capacity`), en lo que usa la pantalla. */
export interface MarketingCapacity {
  status: "ok" | "deferred_cap" | "deferred_quota" | "paused";
  cap: number;
  remaining: number;
  used_today: number;
  manual_cap: number;
  quota: number | null;
  all_today: number;
  warmup_enabled: boolean;
  warmup_level: number;
  warmup_level_date: string | null;
  next_day_start: string;
  time_zone: string;
  paused_at: string | null;
  paused_reason: string | null;
}

export interface MarketingDeliveryData {
  capacity: MarketingCapacity | null;
  stats: { sent: number; bounced: number; complained: number } | null;
  /** "true"/"false" guardado, o null si todavia no se decidio (lo decide la base el primer envio). */
  warmupSaved: boolean | null;
  webhookProblem: string | null;
}

export interface MarketingDeliveryView {
  todayLine: string;
  warmupLine: string;
  paused: { at: string; reason: string } | null;
  statsLine: string | null;
}

function pct(n: number, d: number): string {
  if (d <= 0) return "—";
  return `${((n / d) * 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`;
}

/** Los textos de la seccion. PURO. */
export function marketingDeliveryView(data: MarketingDeliveryData): MarketingDeliveryView {
  const c = data.capacity;
  const todayLine = c
    ? `Hoy salieron ${c.used_today} de ${c.cap} emails de marketing${c.quota !== null ? ` (cuota del plan de Resend: ${c.all_today} de ${c.quota}, contando todos)` : ""}.`
    : "No pude leer cuánto salió hoy.";

  let warmupLine: string;
  if (!c) warmupLine = "";
  else if (c.warmup_enabled) {
    const step = Math.min(Math.max(c.warmup_level, 0), 3);
    const capToday = WARMUP_STEP_CAPS[step];
    warmupLine =
      `Calentamiento: escalón ${step + 1} de 4 (${capToday} por día)` +
      (c.warmup_level_date ? `, desde el ${c.warmup_level_date.split("-").reverse().join("/")}` : "") +
      `. Sube solo cada día que se mandó algo y el freno no saltó, hasta tu máximo (${c.manual_cap}).`;
  } else if (data.warmupSaved === null) {
    warmupLine = "Calentamiento: se decide con el primer envío (prendido si el negocio mandó menos de 500 emails de marketing).";
  } else {
    warmupLine = `Sin calentamiento: rige tu máximo (${c.manual_cap} por día).`;
  }

  const paused = c?.paused_at ? { at: c.paused_at, reason: c.paused_reason ?? "Rebotes o quejas por encima del límite." } : null;
  const s = data.stats;
  const statsLine = s
    ? `Últimas 24 h: ${s.sent} enviados · ${s.bounced} rebotes (${pct(s.bounced, s.sent)}) · ${s.complained} quejas (${pct(s.complained, s.sent)}).${s.sent < 50 ? " Con menos de 50 enviados el freno no calcula." : ""}`
    : null;

  return { todayLine, warmupLine, paused, statsLine };
}

/** Valida el maximo por dia que escribe una persona. PURO. */
export function parseDailyCap(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return { ok: false, error: "Escribí un número entero (por ejemplo 100 o 1000)." };
  const value = Number(text);
  if (value < 1) return { ok: false, error: "El máximo tiene que ser al menos 1. Para frenar todo, usá la pausa." };
  if (value > MAX_MARKETING_DAILY_CAP) return { ok: false, error: `El máximo no puede pasar de ${MAX_MARKETING_DAILY_CAP.toLocaleString("es-AR")}.` };
  return { ok: true, value };
}
