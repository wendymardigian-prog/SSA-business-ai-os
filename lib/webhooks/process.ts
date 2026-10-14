/**
 * El procesamiento de un envio ya guardado (F2 paso 10, F6, F15). SOLO servidor.
 *
 * - `processInbound`: toma el envio con un claim condicional `received -> processing` (si ya lo
 *   tomo otro proceso, no hace nada), corre los flujos, guarda el resultado y el estado final.
 * - `reprocessInbound`: vuelve a correr con la version publicada actual; el claim es sobre
 *   `reprocess_count`, asi un doble clic corre una sola vez por numero de reproceso. Los flujos que YA
 *   corrieron para ese envio NO se repiten (solo vuelven a mapear el contacto), salvo que la persona marque
 *   «Volver a correr tambien los flujos que ya corrieron» (`rerunCompleted`).
 *
 * Nunca lanza hacia el receptor: un fallo queda en el envio (`error`) para poder reprocesar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { createNotificationOnce } from "@/lib/notifications/create";
import { shouldAlert } from "./alerts";
import { lastContactId, summarizeResult } from "./result";
import { runWebhookFlows, type InboundForFlows, type RunFlows } from "./run-flows";
import type { FlowResult } from "./types";

type Db = SupabaseClient<Database>;

const INBOUND_COLUMNS = "id, workspace_id, endpoint_id, payload, query, received_at, reprocess_count, status, result";

export type ProcessOutcome =
  | { kind: "processed"; status: "processed" | "error" }
  | { kind: "not_claimed" }
  | { kind: "not_found" }
  | { kind: "no_payload" };

interface ProcessOptions {
  runFlows?: RunFlows;
  now?: () => Date;
  /** «Volver a correr también los flujos que ya corrieron»: solo un reproceso con la casilla. */
  rerunCompleted?: boolean;
}

/** Procesa un envio `received`. Idempotente: si otro proceso ya lo tomo, no hace nada. */
export async function processInbound(db: Db, inboundId: string, options: ProcessOptions = {}): Promise<ProcessOutcome> {
  const now = (options.now ?? (() => new Date()))();
  const { data: claimed } = await db
    .from("inbound_webhooks")
    .update({ status: "processing", processing_started_at: now.toISOString() } as never)
    .eq("id", inboundId)
    .eq("status", "received")
    .select(INBOUND_COLUMNS);
  const row = (claimed ?? [])[0] as unknown as (InboundForFlows & { status: string }) | undefined;
  if (!row) return { kind: "not_claimed" };
  return finishProcessing(db, row, options);
}

/**
 * Vuelve a correr un envio. `expectedCount` es el `reprocess_count` que tenia la persona en
 * pantalla: si ya cambio, otro reproceso se adelanto y este no hace nada.
 */
export async function reprocessInbound(db: Db, inboundId: string, expectedCount: number, options: ProcessOptions = {}): Promise<ProcessOutcome> {
  const now = (options.now ?? (() => new Date()))();
  const { data: current } = await db.from("inbound_webhooks").select("id, payload, status").eq("id", inboundId).maybeSingle();
  if (!current) return { kind: "not_found" };
  if ((current as { payload: unknown }).payload === null) return { kind: "no_payload" };

  const { data: claimed } = await db
    .from("inbound_webhooks")
    .update({
      status: "processing",
      reprocess_count: expectedCount + 1,
      processing_started_at: now.toISOString(),
      error_message: null,
    } as never)
    .eq("id", inboundId)
    .eq("reprocess_count", expectedCount)
    .in("status", ["error", "paused", "captured", "processed", "ignored"])
    .select(INBOUND_COLUMNS);
  const row = (claimed ?? [])[0] as unknown as (InboundForFlows & { status: string }) | undefined;
  if (!row) return { kind: "not_claimed" };
  return finishProcessing(db, row, options);
}

async function finishProcessing(db: Db, row: InboundForFlows, options: ProcessOptions): Promise<ProcessOutcome> {
  const now = (options.now ?? (() => new Date()))();
  const run = options.runFlows ?? runWebhookFlows;

  let flows: Record<string, FlowResult> = {};
  let crashed: string | null = null;
  try {
    const { data: endpoint } = await db.from("webhook_endpoints").select("id, workspace_id, name").eq("id", row.endpoint_id).maybeSingle();
    if (!endpoint) throw new Error("el endpoint ya no existe");
    flows = await run({ db, inbound: row, endpoint: endpoint as { id: string; workspace_id: string; name: string }, rerunCompleted: options.rerunCompleted });
  } catch (err) {
    crashed = err instanceof Error ? err.message : String(err);
  }

  // Un reproceso corre solo lo que todavia no corrio: lo que ya se sabia de los demas flujos NO se pierde.
  // Lo que corrio ahora reemplaza a su propia entrada (un flujo que fallo y ahora anduvo, por ejemplo).
  const merged: Record<string, FlowResult> = { ...(row.result?.flows ?? {}), ...flows };

  const summary = crashed
    ? { status: "error" as const, summary: `Error: ${crashed}`, errorMessage: crashed }
    : summarizeResult(merged);

  await db
    .from("inbound_webhooks")
    .update({
      status: summary.status,
      result: { flows: merged, summary: summary.summary } as unknown as Json,
      error_message: summary.errorMessage,
      contact_id: lastContactId(merged),
      processed_at: now.toISOString(),
    } as never)
    .eq("id", row.id)
    .eq("status", "processing");

  if (summary.status === "error") await alertIfFailing(db, row.workspace_id, row.endpoint_id, now);
  return { kind: "processed", status: summary.status };
}

/** 5 errores en 1 hora = un aviso en la campana (a quien creo el endpoint y a Owner/Admin). */
export async function alertIfFailing(db: Db, workspaceId: string, endpointId: string, now: Date): Promise<void> {
  try {
    const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const { count } = await db
      .from("inbound_webhooks")
      .select("id", { count: "exact", head: true })
      .eq("endpoint_id", endpointId)
      .eq("status", "error")
      .gte("received_at", since);
    const { data: endpoint } = await db
      .from("webhook_endpoints")
      .select("name, created_by, last_error_alert_at")
      .eq("id", endpointId)
      .maybeSingle();
    const ep = endpoint as { name: string; created_by: string | null; last_error_alert_at: string | null } | null;
    if (!ep || !shouldAlert(count ?? 0, ep.last_error_alert_at, now)) return;

    // Primero se marca (condicional): dos procesos a la vez no avisan dos veces.
    const { data: marked } = await db
      .from("webhook_endpoints")
      .update({ last_error_alert_at: now.toISOString() } as never)
      .eq("id", endpointId)
      .or(`last_error_alert_at.is.null,last_error_alert_at.lt.${since}`)
      .select("id");
    if ((marked ?? []).length === 0) return;

    const base = {
      supabase: db,
      workspaceId,
      type: "webhook_errors" as const,
      title: `El webhook «${ep.name}» está fallando`,
      body: `Tuvo ${count} envíos con error en la última hora. Abrí el historial para ver qué pasó y reprocesar.`,
      entityType: "webhook_endpoint" as const,
      entityId: endpointId,
      withinMinutes: 60,
    };
    // A quien lo creo y a Owner/Admin (recipientId omitido = Owner/Admin).
    await createNotificationOnce({ ...base, perRecipient: true });
    if (ep.created_by) await createNotificationOnce({ ...base, recipientId: ep.created_by, perRecipient: true });
  } catch (err) {
    console.error("[hooks] no pude revisar el aviso de errores:", err instanceof Error ? err.message : String(err));
  }
}
