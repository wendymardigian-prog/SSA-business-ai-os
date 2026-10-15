/**
 * Lo que pasó con un flujo de webhook DESPUÉS de una pausa (Tirón 2, C3). SOLO servidor.
 *
 * `run-flows` anota el resultado de cada flujo cuando termina de correr. Pero un flujo con un «Esperar» queda
 * `pending` y lo despierta el cron mucho después: si ahí termina o FALLA, el historial del envío se quedaba en
 * «en curso» para siempre y nadie veía el error. Este módulo vuelve a escribir el resultado de ESE flujo en el envío
 * (y el estado y el resumen del envío, con la misma regla de siempre: `summarizeResult`).
 *
 * - Nunca lanza: un fallo acá no puede frenar al cron ni dejar una sesión sin cerrar.
 * - La actualización es CONDICIONAL sobre el `result` que se leyó (dos flujos del mismo envío que terminan a la
 *   vez no se pisan: el que pierde vuelve a leer y a aplicar, hasta 3 veces).
 * - No toca un envío que se está reprocesando (`processing`): ese cierre ya va a escribir el resultado completo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { lastContactId, summarizeResult } from "./result";
import type { FlowResult, InboundResult } from "./types";

type Db = SupabaseClient<Database>;

export type ResumeOutcome = { status: "completed" } | { status: "pending" } | { status: "failed"; error: string };

const MAX_ATTEMPTS = 3;
const MAX_ERROR_CHARS = 500;

/** El resultado de los flujos del envío con lo que pasó con UNO de ellos después de la pausa. Puro. */
export function applyResumeOutcome(args: {
  flows: Record<string, FlowResult>;
  flowId: string;
  flowName?: string | null;
  outcome: ResumeOutcome;
  /** Los pasos que se salteó después de la pausa (necesitaban un contacto y no había). */
  skippedSteps?: string[];
  now: Date;
}): Record<string, FlowResult> {
  const { flows, flowId, outcome } = args;
  const before = flows[flowId];
  const skipped = [...new Set([...(before?.skipped_steps ?? []), ...(args.skippedSteps ?? [])])];

  const entry: FlowResult = {
    ...(before ?? { flow_name: args.flowName ?? null }),
    status: outcome.status,
    skipped_steps: skipped.length > 0 ? skipped : null,
    error: outcome.status === "failed" ? outcome.error.slice(0, MAX_ERROR_CHARS) : null,
    finished_at: outcome.status === "pending" ? before?.finished_at ?? null : args.now.toISOString(),
  };
  return { ...flows, [flowId]: entry };
}

export async function settleInboundAfterResume(
  db: Db,
  args: { inboundId: string; flowId: string; outcome: ResumeOutcome; skippedSteps?: string[]; now?: Date },
): Promise<void> {
  try {
    const now = args.now ?? new Date();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data } = await db
        .from("inbound_webhooks")
        .select("id, status, result, contact_id")
        .eq("id", args.inboundId)
        .maybeSingle();
      const row = data as { id: string; status: string; result: InboundResult | null; contact_id: string | null } | null;
      if (!row || !["processed", "error"].includes(row.status)) return;

      const current = row.result ?? {};
      let flowName: string | null = null;
      if (!current.flows?.[args.flowId]) {
        const { data: flow } = await db.from("flows").select("name").eq("id", args.flowId).maybeSingle();
        flowName = (flow as { name: string } | null)?.name ?? null;
      }

      const flows = applyResumeOutcome({ flows: current.flows ?? {}, flowId: args.flowId, flowName, outcome: args.outcome, skippedSteps: args.skippedSteps, now });
      const summary = summarizeResult(flows);

      const { data: updated } = await db
        .from("inbound_webhooks")
        .update({
          status: summary.status,
          result: { flows, summary: summary.summary } as unknown as Json,
          error_message: summary.errorMessage,
          contact_id: lastContactId(flows) ?? row.contact_id,
        } as never)
        .eq("id", row.id)
        .in("status", ["processed", "error"])
        .filter("result", "eq", JSON.stringify(current))
        .select("id");
      if ((updated ?? []).length > 0) return;
      // Otro flujo del mismo envío escribió primero: se vuelve a leer y a aplicar.
    }
    console.error("[hooks] no pude anotar el resultado de un flujo retomado: el envío cambiaba a cada intento");
  } catch (err) {
    console.error("[hooks] no pude anotar el resultado de un flujo retomado:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Lo que usa el cron: después de retomar la sesión `sessionId` (o de que falle), anota en el envío de webhook que
 * la sostiene qué pasó. Si la sesión no es de un webhook (casi todas), no hace nada. Nunca lanza.
 *
 * - `failure`: el motivo si el retomado falló (la sesión ya se canceló); queda `failed`.
 * - Sin `failure`, el estado sale de la sesión: terminó (`completed`), volvió a esperar (`pending`) o se canceló
 *   por dentro (`failed`: el flujo se editó y el paso donde esperaba ya no existe).
 */
export async function settleResumedSession(
  db: Db,
  args: { sessionId: string; failure?: string | null; skippedSteps?: string[]; now?: Date },
): Promise<void> {
  try {
    const { data } = await db.from("flow_sessions").select("inbound_webhook_id, flow_id, status").eq("id", args.sessionId).maybeSingle();
    const session = data as { inbound_webhook_id: string | null; flow_id: string; status: string } | null;
    if (!session?.inbound_webhook_id) return;

    let outcome: ResumeOutcome;
    if (args.failure) outcome = { status: "failed", error: args.failure };
    else if (session.status === "completed") outcome = { status: "completed" };
    else if (session.status === "active") outcome = { status: "pending" };
    else outcome = { status: "failed", error: "La sesión del flujo se canceló: el flujo se editó y el paso donde esperaba ya no existe." };

    await settleInboundAfterResume(db, { inboundId: session.inbound_webhook_id, flowId: session.flow_id, outcome, skippedSteps: args.skippedSteps, now: args.now });
  } catch (err) {
    console.error("[hooks] no pude anotar el resultado de una sesión retomada:", err instanceof Error ? err.message : String(err));
  }
}
