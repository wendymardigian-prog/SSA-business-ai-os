/**
 * Cómo queda un envío de la cola de WhatsApp después de un intento: su estado y su motivo. Lo usa el despachador
 * (`run-queue.ts`). Solo servidor. Cada UPDATE es condicional (`status = 'sending'`): si entre medio alguien vació la
 * cola, no se pisa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { retryPlan } from "./retry";
import type { DeliverOutcome, QueueItem } from "./deliver";

type Db = SupabaseClient<Database>;

/** Un `rate_limited` (el tope de 200/h del número) vuelve a mirar en 5 minutos sin gastar intento. */
export const RATE_LIMIT_WAIT_MS = 5 * 60_000;

export interface QueueSummary {
  lanes: number;
  sent: number;
  failed: number;
  discarded: number;
  expired: number;
  released: number;
  reaped: number;
}

export function emptySummary(): QueueSummary {
  return { lanes: 0, sent: 0, failed: 0, discarded: 0, expired: 0, released: 0, reaped: 0 };
}

/** El cambio de la fila según lo que pasó. PURO. `attempts`: los fallos que llevaba antes de este intento. */
export function settlePatch(outcome: DeliverOutcome, attempts: number, now: Date): { patch: Database["public"]["Tables"]["send_queue_items"]["Update"]; failures: "reset" | "add" | "keep"; final: boolean } {
  const at = now.toISOString();
  switch (outcome.kind) {
    case "sent":
      return {
        patch: { status: "sent", sent_at: at, platform_message_id: outcome.messageId, reason_code: null, reason: null, error_kind: null, next_attempt_at: null, updated_at: at },
        failures: "reset",
        final: true,
      };
    case "discarded":
      return { patch: { status: "discarded", reason_code: outcome.code, reason: outcome.reason.slice(0, 500), updated_at: at }, failures: "keep", final: true };
    case "rate_limited":
      return {
        patch: {
          status: "queued",
          claimed_at: null,
          reason_code: "waiting_quota",
          reason: "El número llegó al tope de mensajes automáticos de la hora.",
          next_attempt_at: new Date(now.getTime() + RATE_LIMIT_WAIT_MS).toISOString(),
          updated_at: at,
        },
        failures: "keep",
        final: false,
      };
    case "failed": {
      const plan = retryPlan(outcome.errorKind, attempts, now);
      if (plan.retry) {
        return {
          patch: {
            status: "queued",
            attempts: plan.attempts,
            claimed_at: null,
            next_attempt_at: plan.nextAttemptAt.toISOString(),
            error_kind: outcome.errorKind,
            reason_code: "transport",
            reason: `Intento ${plan.attempts} falló (${outcome.message}). Se reintenta.`.slice(0, 500),
            updated_at: at,
          },
          failures: "add",
          final: false,
        };
      }
      return {
        patch: { status: "failed", attempts: plan.attempts, error_kind: outcome.errorKind, reason_code: outcome.errorKind, reason: outcome.message.slice(0, 500), next_attempt_at: null, updated_at: at },
        failures: "add",
        final: true,
      };
    }
  }
}

/** Deja el envío con su estado y su motivo. Devuelve qué hacer con los fallos seguidos del número. */
export async function settleQueueItem(service: Db, item: QueueItem, outcome: DeliverOutcome, now: Date, summary?: QueueSummary): Promise<"reset" | "add" | "keep"> {
  const { patch, failures, final } = settlePatch(outcome, item.attempts, now);
  const { error } = await service.from("send_queue_items").update(patch).eq("id", item.id).eq("status", "sending");
  if (error) console.error("[send-queue] no pude guardar cómo quedó el envío:", error.message);
  if (outcome.kind === "failed" && final) {
    // Solo el último intento deja el mensaje fallido en la conversación.
    try {
      await outcome.record?.();
    } catch (e) {
      console.error("[send-queue] no pude anotar el envío fallido:", e instanceof Error ? e.message : "error");
    }
  }
  if (summary) {
    if (outcome.kind === "sent") summary.sent += 1;
    else if (outcome.kind === "discarded") summary.discarded += 1;
    else if (outcome.kind === "failed") summary.failed += 1;
  }
  return failures;
}
