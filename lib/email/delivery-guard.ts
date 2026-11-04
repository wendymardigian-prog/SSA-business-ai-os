/**
 * La guardia unica de entrega (automatizaciones de email, Fase 1a, A6).
 *
 * Un solo lugar decide si un email de MARKETING sale ahora, sale manana o espera a que alguien reanude:
 *  - el tope del dia = el mas bajo entre el maximo que eligio el negocio (default 100) y el escalon del calentamiento
 *    (100 → 200 → 400 → 800 → terminado), contado en el dia del NEGOCIO;
 *  - la cuota del plan de Resend (`daily_quota`), solo si esta cargada: todos los emails del dia;
 *  - el freno (`marketing-brake.ts`): pausa todo el marketing hasta que alguien lo reanude.
 * Lo transaccional nunca espera ni cuenta para el tope de marketing.
 *
 * La decision vive en la base (`private.email_guard_decide`, 00287) y aca (`decideEmailSend`), con los mismos casos
 * (`delivery-guard.cases.json`): si se cambia una regla, se cambia en las dos y se suma el caso.
 *
 * Lo que excede el tope NO falla ni se pierde: el envio vuelve `deferred` con `retryAt` (el inicio del dia siguiente
 * en la zona del negocio, o una hora mas si esta pausado) y cada llamador lo reagenda: la cola de broadcasts, los
 * flujos (vuelven a correr el mismo paso) y las secuencias.
 *
 * La reserva (`reserveEmailSend`) inserta la fila de `email_log` en `reserved` con candado por negocio: dos envios a
 * la vez no pasan el tope. El envio la cierra en `sent`/`failed` (`settleReservedEmail`).
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Los escalones del calentamiento, en emails de marketing por dia. */
export const WARMUP_STEPS = [100, 200, 400, 800] as const;
/** El maximo por dia si el negocio no eligio otro. */
export const DEFAULT_MARKETING_DAILY_CAP = 100;
/** Un negocio que mando menos que esto de marketing en su vida arranca con el calentamiento prendido. */
export const WARMUP_LIFETIME_THRESHOLD = 500;
/** Si la base no contesta al reservar, el marketing espera esto y vuelve a probar (lo transaccional sale igual). */
export const GUARD_UNAVAILABLE_RETRY_MS = 15 * 60_000;

export type GuardStatus = "ok" | "deferred_cap" | "deferred_quota" | "paused";

export interface GuardInput {
  category: "marketing" | "transactional";
  /** El dia del negocio, `AAAA-MM-DD`. */
  today: string;
  manual_cap?: number | null;
  /** null = todavia no se decidio (se decide por `lifetime_marketing_sent`). */
  warmup_enabled?: boolean | null;
  warmup_level?: number | null;
  warmup_level_date?: string | null;
  lifetime_marketing_sent?: number | null;
  /** Salio marketing desde el dia del escalon hasta ayer. */
  sent_since_level?: boolean | null;
  /** El freno salto desde el dia del escalon. */
  brake_since_level?: boolean | null;
  paused?: boolean | null;
  quota?: number | null;
  marketing_today?: number | null;
  all_today?: number | null;
}

export interface GuardDecision {
  status: GuardStatus;
  cap: number;
  remaining: number;
  warmup_enabled: boolean;
  warmup_level: number;
  warmup_level_date: string | null;
  warmup_completed: boolean;
  warmup_changed: boolean;
}

/** PURA. Gemela de `private.email_guard_decide` (00287). */
export function decideEmailSend(p: GuardInput): GuardDecision {
  const today = p.today;
  let changed = false;
  let completed = false;
  let enabled: boolean;
  let level = p.warmup_level ?? 0;
  let levelDate = p.warmup_level_date || null;

  if (p.warmup_enabled === null || p.warmup_enabled === undefined) {
    enabled = (p.lifetime_marketing_sent ?? 0) < WARMUP_LIFETIME_THRESHOLD;
    changed = true;
  } else {
    enabled = p.warmup_enabled;
  }

  if (enabled) {
    level = Math.min(Math.max(level, 0), 3);
    if (levelDate === null) {
      levelDate = today;
      changed = true;
    } else if (levelDate < today) {
      if (p.brake_since_level) {
        levelDate = today;
        changed = true;
      } else if (p.sent_since_level) {
        level += 1;
        levelDate = today;
        changed = true;
        if (level > 3) {
          enabled = false;
          completed = true;
        }
      }
    }
  }

  const manual = Math.max(0, p.manual_cap ?? DEFAULT_MARKETING_DAILY_CAP);
  const cap = enabled ? Math.min(manual, WARMUP_STEPS[level]) : manual;
  const marketingToday = p.marketing_today ?? 0;
  const allToday = p.all_today ?? 0;
  const quota = p.quota ?? null;

  let remaining = Math.max(0, cap - marketingToday);
  if (quota !== null) remaining = Math.min(remaining, Math.max(0, quota - allToday));

  let status: GuardStatus;
  if (p.category !== "marketing") status = "ok";
  else if (p.paused) status = "paused";
  else if (marketingToday >= cap) status = "deferred_cap";
  else if (quota !== null && allToday >= quota) status = "deferred_quota";
  else status = "ok";

  return {
    status,
    cap,
    remaining: status === "paused" ? 0 : remaining,
    warmup_enabled: enabled,
    warmup_level: enabled || completed ? Math.min(level, 4) : level,
    warmup_level_date: levelDate,
    warmup_completed: completed,
    warmup_changed: changed,
  };
}

/** Por que un email de marketing no sale ahora. */
export type DeferReason = "daily_cap" | "quota" | "paused" | "unavailable";

export const DEFER_MESSAGES: Record<DeferReason, string> = {
  daily_cap: "Se llegó al máximo de emails de marketing del día: sale mañana.",
  quota: "Se llegó a la cuota diaria del plan de Resend: sale mañana.",
  paused: "Los emails de marketing están pausados por el freno automático: salen cuando alguien los reanude.",
  unavailable: "No pude comprobar el tope de envíos: vuelve a probar en unos minutos.",
};

export type ReserveResult =
  | { ok: true; logId: string | null }
  | { ok: false; reason: DeferReason; retryAt: Date; message: string };

/** El estado de la guardia tal como lo devuelve la base (`email_send_capacity` / `reserve_email_send`). */
export interface GuardState extends GuardDecision {
  retry_at: string | null;
  used_today: number;
  all_today: number;
  quota: number | null;
  manual_cap: number;
  day_start: string;
  next_day_start: string;
  time_zone: string;
  paused_at: string | null;
  paused_reason: string | null;
  log_id?: string;
}

function deferReasonOf(status: GuardStatus): DeferReason {
  if (status === "paused") return "paused";
  if (status === "deferred_quota") return "quota";
  return "daily_cap";
}

/**
 * Reserva el lugar de un email de marketing. Nunca lanza: si la base no contesta, el marketing espera
 * `GUARD_UNAVAILABLE_RETRY_MS` (no se manda a ciegas pasando el tope).
 */
export async function reserveEmailSend(
  service: SupabaseClient,
  params: {
    workspaceId: string;
    to: string;
    subject: string;
    kind: string;
    contactId?: string | null;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    createdBy?: string | null;
    flowNodeId?: string | null;
    automationRunId?: string | null;
  },
  now: Date = new Date(),
): Promise<ReserveResult> {
  try {
    const { data, error } = await service.rpc("reserve_email_send", {
      p_workspace_id: params.workspaceId,
      p_to: params.to,
      p_subject: params.subject,
      p_kind: params.kind,
      p_contact_id: params.contactId ?? null,
      p_related_type: params.relatedEntityType ?? null,
      p_related_id: params.relatedEntityId ?? null,
      p_created_by: params.createdBy ?? null,
      p_flow_node_id: params.flowNodeId ?? null,
      p_automation_run_id: params.automationRunId ?? null,
    });
    if (error || !data) throw new Error(error?.message ?? "sin respuesta");
    const state = data as Partial<GuardState>;
    if (state.status === "ok") {
      if (state.warmup_completed) void notifyWarmupDone(service, params.workspaceId);
      return { ok: true, logId: typeof state.log_id === "string" ? state.log_id : null };
    }
    const reason = deferReasonOf((state.status ?? "deferred_cap") as GuardStatus);
    const retryAt = state.retry_at ? new Date(state.retry_at) : new Date(now.getTime() + GUARD_UNAVAILABLE_RETRY_MS);
    if (reason !== "paused") void notifyCapReached(service, params.workspaceId, reason, state);
    return { ok: false, reason, retryAt, message: DEFER_MESSAGES[reason] };
  } catch (err) {
    console.error("[email-guard] no pude reservar el envio:", err instanceof Error ? err.message : "error");
    return {
      ok: false,
      reason: "unavailable",
      retryAt: new Date(now.getTime() + GUARD_UNAVAILABLE_RETRY_MS),
      message: DEFER_MESSAGES.unavailable,
    };
  }
}

/** Cierra una reserva con lo que paso. Un fallo aca no cambia el resultado del envio. */
export async function settleReservedEmail(
  service: SupabaseClient,
  logId: string,
  row: { status: "sent" | "failed"; provider_message_id?: string | null; attempts?: number; last_error?: string | null },
): Promise<void> {
  const { error } = await service
    .from("email_log")
    .update({
      status: row.status,
      provider_message_id: row.provider_message_id ?? null,
      attempts: row.attempts ?? 0,
      last_error: row.last_error ?? null,
    })
    .eq("id", logId)
    .eq("status", "reserved");
  if (error) console.error("[email-guard] no pude cerrar la reserva:", error.message);
}

/** Cuanto queda hoy, sin reservar. Null si la base no contesta (quien llama decide: la cola no reclama). */
export async function emailSendCapacity(service: SupabaseClient, workspaceId: string): Promise<GuardState | null> {
  try {
    const { data, error } = await service.rpc("email_send_capacity", { p_workspace_id: workspaceId });
    if (error || !data) return null;
    return data as GuardState;
  } catch {
    return null;
  }
}

/** Avisa a Owner/Admin que se lleno el tope del dia. Una vez por dia (la ventana de la campana). Nunca lanza. */
async function notifyCapReached(service: SupabaseClient, workspaceId: string, reason: DeferReason, state: Partial<GuardState>): Promise<void> {
  try {
    const { createNotificationOnce } = await import("@/lib/notifications/create");
    await createNotificationOnce({
      supabase: service as never,
      workspaceId,
      type: "email_quota_reached",
      title: reason === "quota" ? "Se llenó la cuota diaria de Resend" : "Se llegó al máximo de emails de marketing de hoy",
      body:
        reason === "quota"
          ? "Los emails de marketing que faltan salen mañana. Los transaccionales siguen saliendo."
          : `Salieron ${state.used_today ?? state.cap ?? "?"} de ${state.cap ?? "?"}. Los que faltan quedan pendientes y salen mañana, en orden.`,
      entityType: "integration",
      entityId: workspaceId,
      metadata: { reason, cap: state.cap ?? null, warmup_level: state.warmup_level ?? null },
      withinMinutes: 12 * 60,
    });
  } catch (err) {
    console.error("[email-guard] no pude avisar el tope:", err instanceof Error ? err.message : "error");
  }
}

async function notifyWarmupDone(service: SupabaseClient, workspaceId: string): Promise<void> {
  try {
    const { createNotificationOnce } = await import("@/lib/notifications/create");
    await createNotificationOnce({
      supabase: service as never,
      workspaceId,
      type: "integration_attention",
      title: "Terminó el calentamiento del dominio",
      body: "Desde hoy rige el máximo de emails de marketing por día que elegiste en Resend.",
      entityType: "integration",
      entityId: workspaceId,
      withinMinutes: 24 * 60,
    });
  } catch {
    /* un aviso nunca frena un envio */
  }
}
