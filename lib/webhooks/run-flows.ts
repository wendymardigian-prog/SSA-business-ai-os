/**
 * Corre los flujos publicados que escuchan un envío (F9, F10, F15). SOLO servidor.
 *
 * NO usa la cola `automation_events` (exige contacto): corre DIRECTO desde el procesamiento del envío,
 * con el mismo reclamo en `trigger_fires` que usa el cron:
 *   1. lee los `triggers` activos de tipo `webhook_received` con este `endpointId`, de flujos publicados;
 *   2. evalúa el «Solo si…» con el evaluador de Condiciones;
 *   3. reclama el disparo (`webhook:<envío>:<flujo>:<reproceso>`): un envío procesado dos veces sin
 *      reprocesar (el reaper y el `after()`) corre cada flujo una sola vez;
 *   4. llama a `executeFlow` SIN contacto (`contactId: null`, `inboundWebhookId`), con el envío en
 *      `variables.webhook`.
 *
 * El resultado por flujo (qué pasó con el contacto, el diff, el toque, los pasos salteados, el error) se
 * guarda en `inbound_webhooks.result.flows[flowId]`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { executeFlow } from "@/lib/flow-engine/engine";
import "@/lib/flow-engine/registry";
import type { ContactStepInfo, FlowExecutionContext } from "@/lib/flow-engine/types";
import { evaluateWebhookConditions, parseWebhookTriggerConfig, webhookDedupeKey, webhookVariables, WEBHOOK_TRIGGER_TYPE } from "./trigger-config";
import type { FlowResult } from "./types";

type Db = SupabaseClient<Database>;

export interface InboundForFlows {
  id: string;
  workspace_id: string;
  endpoint_id: string;
  payload: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  received_at: string;
  reprocess_count: number;
}

export interface EndpointForFlows {
  id: string;
  workspace_id: string;
  name: string;
}

export type RunFlows = (args: { db: Db; inbound: InboundForFlows; endpoint: EndpointForFlows }) => Promise<Record<string, FlowResult>>;

interface TriggerWithFlow {
  id: string;
  flow_id: string;
  config: unknown;
  priority: number | null;
  flows: { id: string; name: string; status: string } | { id: string; name: string; status: string }[];
}

const flowOf = (t: TriggerWithFlow) => (Array.isArray(t.flows) ? t.flows[0] : t.flows);

/** De lo que contó el paso de contacto al resultado del flujo que se guarda en el historial. */
export function contactStepToResult(info: ContactStepInfo): Partial<FlowResult> {
  return {
    contact_id: info.contactId,
    contact_name: info.contactName,
    contact_result: info.result,
    contact_fail_reason: info.failReason,
    diff: info.diff,
    conflict: info.conflict,
    touch: info.touch,
    notes: info.notes.length > 0 ? info.notes : null,
  };
}

export const runWebhookFlows: RunFlows = async ({ db, inbound, endpoint }) => {
  const results: Record<string, FlowResult> = {};

  const { data } = await db
    .from("triggers")
    .select("id, flow_id, config, priority, flows!inner(id, name, status)")
    .eq("workspace_id", inbound.workspace_id)
    .eq("type" as never, WEBHOOK_TRIGGER_TYPE)
    .eq("is_active", true)
    .eq("flows.status", "published");

  const triggers = ((data ?? []) as unknown as TriggerWithFlow[])
    .filter((t) => parseWebhookTriggerConfig(t.config).endpointId === endpoint.id)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const trigger of triggers) {
    const flow = flowOf(trigger);
    if (!flow) continue;
    const config = parseWebhookTriggerConfig(trigger.config);
    const name = flow.name;

    const variables = webhookVariables({
      inboundId: inbound.id,
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      receivedAt: inbound.received_at,
      payload: inbound.payload,
      query: inbound.query,
      reprocessCount: inbound.reprocess_count,
    });

    if (!evaluateWebhookConditions(config, variables).passed) {
      results[flow.id] = { status: "skipped_condition", flow_name: name, error: "no cumplió la condición" };
      continue;
    }

    // El reclamo: el indice unico de trigger_fires decide. 23505 = ya corrio (el caso normal de un
    // doble procesamiento), no es un error.
    const { error: claimError } = await db.from("trigger_fires").insert({
      trigger_id: trigger.id,
      workspace_id: inbound.workspace_id,
      dedupe_key: webhookDedupeKey(inbound.id, flow.id, inbound.reprocess_count),
      contact_id: null,
    } as never);
    if (claimError) {
      if (claimError.code !== "23505") console.error("[hooks] no pude reclamar el disparo:", claimError.message);
      continue;
    }

    results[flow.id] = await runOneFlow(db, { trigger, flowId: flow.id, flowName: name, inbound, variables });
  }

  return results;
};

async function runOneFlow(
  db: Db,
  args: { trigger: TriggerWithFlow; flowId: string; flowName: string; inbound: InboundForFlows; variables: Record<string, unknown> },
): Promise<FlowResult> {
  const { trigger, flowId, flowName, inbound, variables } = args;
  const skipped: string[] = [];
  let step: Partial<FlowResult> = {};

  const context: FlowExecutionContext = {
    triggerId: trigger.id,
    flowId,
    channelId: "",
    contactId: null,
    inboundWebhookId: inbound.id,
    conversationId: "",
    workspaceId: inbound.workspace_id,
    incomingMessage: {},
    variables,
    onStepSkipped: (s) => skipped.push(s.label),
    onContactStep: (info) => {
      step = contactStepToResult(info);
    },
  };

  const base = (): Partial<FlowResult> => ({ flow_name: flowName, ...step, skipped_steps: skipped.length > 0 ? skipped : null });

  try {
    await executeFlow(db, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Un paso reventó (un fallo de base): la sesión no puede quedar «activa» para siempre.
    await db.from("flow_sessions").update({ status: "cancelled" }).eq("inbound_webhook_id" as never, inbound.id).eq("flow_id", flowId).eq("status", "active");
    return { status: "failed", ...base(), error: message, finished_at: new Date().toISOString() };
  }

  const { data: session } = await db
    .from("flow_sessions")
    .select("id, status, contact_id")
    .eq("inbound_webhook_id" as never, inbound.id)
    .eq("flow_id", flowId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const s = session as { status: string; contact_id: string | null } | null;
  if (!s) return { status: "failed", ...base(), error: "El flujo no pudo iniciar.", finished_at: new Date().toISOString() };

  const contactId = s.contact_id ?? step.contact_id ?? null;
  if (s.status === "active") return { status: "pending", ...base(), contact_id: contactId };
  return { status: "completed", ...base(), contact_id: contactId, finished_at: new Date().toISOString() };
}
