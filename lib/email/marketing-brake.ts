/**
 * El freno automatico del marketing (automatizaciones de email, Fase 1a, A6).
 *
 * Si en las ultimas 24 horas, con al menos 50 emails de marketing enviados, los rebotes o las quejas superan su limite
 * (por defecto 2 % y 0,05 %; cada negocio los cambia en «Entrega de marketing», `lib/email/brake-limits.ts`), SSA pausa
 * TODO el marketing del negocio y avisa a Owner/Admin. Los transaccionales siguen. Se reanuda a mano
 * (Ajustes → Integraciones → Resend, con confirmacion), y queda en `audit_log` quien pauso (el sistema) y quien reanudo.
 *
 * Se evalua cuando llega un rebote o una queja de un email de marketing: es el unico momento en que el cociente sube.
 * La pausa vive en la config de Resend (`marketing_paused_at`), que es lo que mira la guardia (`reserve_email_send`).
 *
 * Solo servidor. Nunca lanza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { brakeLimitsFromConfig, DEFAULT_BRAKE_LIMITS, formatBrakePct, pctToRate, type BrakeLimits } from "./brake-limits";

/** Con menos de esto enviado en 24 h no se calcula (un rebote sobre 3 envios no dice nada). */
export const BRAKE_MIN_SENT = 50;
export const BRAKE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface BrakeStats {
  sent: number;
  bounced: number;
  complained: number;
}

export type BrakeDecision =
  | { trip: false; bounceRate: number | null; complaintRate: number | null }
  | { trip: true; reason: "bounces" | "complaints"; bounceRate: number; complaintRate: number };

/** PURA. Supera = estrictamente mayor que el limite. */
export function brakeDecision(stats: BrakeStats, limits: BrakeLimits = DEFAULT_BRAKE_LIMITS): BrakeDecision {
  if (stats.sent < BRAKE_MIN_SENT) return { trip: false, bounceRate: null, complaintRate: null };
  const bounceRate = stats.bounced / stats.sent;
  const complaintRate = stats.complained / stats.sent;
  if (bounceRate > pctToRate(limits.bouncePct)) return { trip: true, reason: "bounces", bounceRate, complaintRate };
  if (complaintRate > pctToRate(limits.complaintPct)) return { trip: true, reason: "complaints", bounceRate, complaintRate };
  return { trip: false, bounceRate, complaintRate };
}

function percent(rate: number): string {
  return `${(rate * 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`;
}

/** El motivo, en una linea para una persona. */
export function brakeReasonText(decision: Extract<BrakeDecision, { trip: true }>, stats: BrakeStats, limits: BrakeLimits = DEFAULT_BRAKE_LIMITS): string {
  return decision.reason === "bounces"
    ? `Rebotaron ${stats.bounced} de ${stats.sent} emails de marketing en 24 h (${percent(decision.bounceRate)}; el límite es ${formatBrakePct(limits.bouncePct)} %).`
    : `${stats.complained} de ${stats.sent} emails de marketing se marcaron como spam en 24 h (${percent(decision.complaintRate)}; el límite es ${formatBrakePct(limits.complaintPct)} %).`;
}

type Service = SupabaseClient;

/** Lo enviado, rebotado y con queja de las ultimas 24 h (marketing). */
export async function brakeStats(service: Service, workspaceId: string, now: Date = new Date()): Promise<BrakeStats> {
  const since = new Date(now.getTime() - BRAKE_WINDOW_MS).toISOString();
  const base = () =>
    service
      .from("email_log")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("category", "marketing")
      .eq("status", "sent")
      .gte("created_at", since);
  const [sent, bounced, complained] = await Promise.all([
    base(),
    base().not("bounced_at", "is", null),
    base().not("complained_at", "is", null),
  ]);
  if (sent.error || bounced.error || complained.error) {
    throw new Error((sent.error ?? bounced.error ?? complained.error)?.message ?? "no pude contar");
  }
  return { sent: sent.count ?? 0, bounced: bounced.count ?? 0, complained: complained.count ?? 0 };
}

/**
 * Mira si hay que frenar y, si hay que hacerlo, pausa el marketing y avisa. Devuelve si quedo pausado ahora. Nunca
 * lanza: si no se puede contar, no se pausa (y queda en el log).
 */
export async function evaluateMarketingBrake(service: Service, workspaceId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const stats = await brakeStats(service, workspaceId, now);
    const { data: row, error: readError } = await service
      .from("integration_configs")
      .select("config")
      .eq("workspace_id", workspaceId)
      .eq("type", "email_provider")
      .eq("provider", "resend")
      .maybeSingle();
    // Sin poder leer los limites del negocio rigen los de por defecto: mejor frenar de mas que dejar de cuidar el dominio.
    if (readError) console.error("[freno] no pude leer los límites del negocio:", readError.message);
    const config = ((row as { config?: Record<string, unknown> | null } | null)?.config ?? {}) as Record<string, unknown>;
    const limits = brakeLimitsFromConfig(config);
    const decision = brakeDecision(stats, limits);
    if (!decision.trip) return false;

    // Ya pausado: no se vuelve a pausar ni a avisar.
    if (typeof config.marketing_paused_at === "string" && config.marketing_paused_at) return false;

    const reason = brakeReasonText(decision, stats, limits);
    const at = now.toISOString();
    const { error } = await service.rpc("patch_resend_config", {
      p_workspace_id: workspaceId,
      p_patch: {
        marketing_paused_at: at,
        marketing_paused_reason: reason,
        marketing_paused_stats: JSON.stringify(stats),
        marketing_last_brake_at: at,
      },
    });
    if (error) {
      console.error("[freno] no pude pausar el marketing:", error.message);
      return false;
    }

    await notifyPaused(service, workspaceId, reason);
    await auditBrake(service, workspaceId, "email_marketing.paused", { reason: decision.reason, ...stats, ...limits }, null);
    console.log(`[freno] marketing pausado en ${workspaceId}: ${decision.reason}`);
    return true;
  } catch (err) {
    console.error("[freno] no pude evaluar el freno:", err instanceof Error ? err.message : "error");
    return false;
  }
}

/** Reanudar a mano (quien llama ya chequeo el permiso). El calentamiento no sube hasta un dia sin freno. */
export async function resumeMarketing(service: Service, workspaceId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await service.rpc("patch_resend_config", {
    p_workspace_id: workspaceId,
    p_patch: { marketing_paused_at: null, marketing_paused_reason: null, marketing_paused_stats: null },
  });
  if (error) return { ok: false, error: "No pude reanudar los envíos. Probá de nuevo." };
  await auditBrake(service, workspaceId, "email_marketing.resumed", {}, userId);
  return { ok: true };
}

async function notifyPaused(service: Service, workspaceId: string, reason: string): Promise<void> {
  try {
    const { createNotificationOnce } = await import("@/lib/notifications/create");
    await createNotificationOnce({
      supabase: service as never,
      workspaceId,
      type: "email_marketing_paused",
      title: "Se pausaron los emails de marketing",
      body: `${reason} Los transaccionales siguen saliendo. Revisá la lista y reanudá desde Ajustes → Integraciones → Resend.`,
      entityType: "integration",
      entityId: workspaceId,
      metadata: { source: "marketing_brake" },
      withinMinutes: 24 * 60,
    });
  } catch {
    /* un aviso nunca frena nada */
  }
}

async function auditBrake(service: Service, workspaceId: string, action: string, changes: Record<string, unknown>, userId: string | null): Promise<void> {
  try {
    const { logAudit } = await import("@/lib/audit");
    await logAudit({
      supabase: service as never,
      workspaceId,
      entityType: "workspace",
      entityId: workspaceId,
      action: action as "email_marketing.paused" | "email_marketing.resumed",
      changes: changes as never,
      performedBy: userId,
      ...(userId ? {} : { actorType: "system" as const, actorLabel: "Freno automático" }),
    });
  } catch {
    /* el historial nunca frena nada */
  }
}
