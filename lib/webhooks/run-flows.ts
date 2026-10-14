/**
 * Corre los flujos publicados que escuchan un envío (F9, F10, F15). SOLO servidor.
 *
 * NO usa la cola `automation_events` (exige contacto): corre DIRECTO desde el procesamiento del envío,
 * con el mismo reclamo en `trigger_fires` que usa el cron:
 *   1. lee los `triggers` activos de tipo `webhook_received` con este `endpointId`, de flujos publicados;
 *   2. evalúa el «Solo si…» con el evaluador de Condiciones;
 *   3. reclama el disparo (`webhook:<envío>:<flujo>`, SIN el número de reproceso): un envío corre cada flujo
 *      UNA sola vez, lo procesen dos veces (el reaper y el `after()`), dos procesos a la vez o se reprocese.
 *      Si el flujo FALLA, la clave se libera (reprocesar lo reintenta); si la persona pide «volver a correr
 *      también los flujos que ya corrieron» (`rerunCompleted`), se sueltan todas las del envío;
 *   4. llama a `executeFlow` SIN contacto (`contactId: null`, `inboundWebhookId`), con el envío en
 *      `variables.webhook`.
 *
 * Un REPROCESO (sin la casilla) no repite los flujos que ya corrieron, pero SÍ vuelve a mapear el contacto de los que
 * tienen UN solo paso «Crear o actualizar contacto» (idempotente: sin mensajes). Lo demás queda como estaba.
 *
 * El resultado por flujo (qué pasó con el contacto, el diff, el toque, los pasos salteados, el error) se
 * guarda en `inbound_webhooks.result.flows[flowId]`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { executeFlow } from "@/lib/flow-engine/engine";
import "@/lib/flow-engine/registry";
import type { ContactStepInfo, FlowExecutionContext } from "@/lib/flow-engine/types";
import {
  evaluateWebhookConditions,
  parseWebhookTriggerConfig,
  webhookContactKey,
  webhookDedupeKey,
  webhookDedupePrefix,
  webhookVariables,
  WEBHOOK_TRIGGER_TYPE,
} from "./trigger-config";
import { parseUpsertContactConfig } from "./upsert-config";
import { upsertContactFromWebhook } from "./upsert-contact";
import type { FlowResult, InboundResult } from "./types";

type Db = SupabaseClient<Database>;

export interface InboundForFlows {
  id: string;
  workspace_id: string;
  endpoint_id: string;
  payload: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  received_at: string;
  reprocess_count: number;
  /** Lo guardado de la vez anterior (`inbound_webhooks.result`): lo que ya corrió, para no repetirlo. */
  result?: InboundResult | null;
}

export interface EndpointForFlows {
  id: string;
  workspace_id: string;
  name: string;
}

export type RunFlows = (args: {
  db: Db;
  inbound: InboundForFlows;
  endpoint: EndpointForFlows;
  /** «Volver a correr también los flujos que ya corrieron» (un reproceso con la casilla). Apagado por defecto. */
  rerunCompleted?: boolean;
}) => Promise<Record<string, FlowResult>>;

interface FlowOfTrigger {
  id: string;
  name: string;
  status: string;
  nodes?: unknown;
}

interface TriggerWithFlow {
  id: string;
  flow_id: string;
  config: unknown;
  priority: number | null;
  flows: FlowOfTrigger | FlowOfTrigger[];
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

/** Lo que ya se sabe de cada flujo para ESTE envío (de la vez anterior). */
const previousFlows = (inbound: InboundForFlows): Record<string, FlowResult> => inbound.result?.flows ?? {};

export const runWebhookFlows: RunFlows = async ({ db, inbound, endpoint, rerunCompleted }) => {
  const results: Record<string, FlowResult> = {};
  const previous = previousFlows(inbound);

  const { data } = await db
    .from("triggers")
    .select("id, flow_id, config, priority, flows!inner(id, name, status, nodes)")
    .eq("workspace_id", inbound.workspace_id)
    .eq("type" as never, WEBHOOK_TRIGGER_TYPE)
    .eq("is_active", true)
    .eq("flows.status", "published");

  const triggers = ((data ?? []) as unknown as TriggerWithFlow[])
    .filter((t) => parseWebhookTriggerConfig(t.config).endpointId === endpoint.id)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // «Volver a correr también los flujos que ya corrieron»: se sueltan las claves del envío (y las de «una sola
  // vez por contacto» que este envío reclamó) y se cancelan las sesiones que seguían esperando, para que no
  // haya dos corridas del mismo flujo despertando después. Sin la casilla no se toca nada de esto.
  if (rerunCompleted) await releaseForRerun(db, { inbound, previous });

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
      oncePerContactTriggerId: config.oncePerContact ? trigger.id : null,
    });

    if (!evaluateWebhookConditions(config, variables).passed) {
      results[flow.id] = { status: "skipped_condition", flow_name: name, error: "no cumplió la condición" };
      continue;
    }

    // El reclamo: el indice unico de trigger_fires decide. 23505 = ya corrio (el caso normal de un
    // doble procesamiento o de un reproceso sin la casilla), no es un error.
    const dedupeKey = webhookDedupeKey(inbound.id, flow.id);
    const { error: claimError } = await db.from("trigger_fires").insert({
      trigger_id: trigger.id,
      workspace_id: inbound.workspace_id,
      dedupe_key: dedupeKey,
      contact_id: null,
    } as never);
    if (claimError) {
      if (claimError.code !== "23505") {
        console.error("[hooks] no pude reclamar el disparo:", claimError.message);
      } else if (inbound.reprocess_count > 0) {
        // Un REPROCESO (no un doble procesamiento) no repite el flujo, pero vuelve a mapear el contacto.
        const remapped = await remapContact(db, { flow, inbound, endpoint, previous: previous[flow.id] });
        if (remapped) results[flow.id] = remapped;
      }
      continue;
    }

    const result = await runOneFlow(db, { trigger, flowId: flow.id, flowName: name, inbound, variables });
    results[flow.id] = result;
    // Un flujo que FALLÓ no cuenta como «ya corrió»: se suelta la clave y reprocesar lo reintenta.
    if (result.status === "failed") {
      await releaseClaim(db, { triggerId: trigger.id, dedupeKey, flowId: flow.id, contactId: config.oncePerContact ? result.contact_id ?? null : null });
    }
  }

  return results;
};

/** Suelta el reclamo de un flujo que falló (y la marca de «una sola vez por contacto» que ese intento dejó). Nunca lanza. */
async function releaseClaim(db: Db, args: { triggerId: string; dedupeKey: string; flowId: string; contactId: string | null }): Promise<void> {
  try {
    await db.from("trigger_fires").delete().eq("trigger_id", args.triggerId).eq("dedupe_key", args.dedupeKey);
    if (args.contactId) {
      await db.from("trigger_fires").delete().eq("trigger_id", args.triggerId).eq("dedupe_key", webhookContactKey(args.flowId, args.contactId));
    }
  } catch (err) {
    console.error("[hooks] no pude soltar el reclamo de un flujo fallado:", err instanceof Error ? err.message : String(err));
  }
}

/** La casilla «Volver a correr también los flujos que ya corrieron». Nunca lanza. */
async function releaseForRerun(db: Db, args: { inbound: InboundForFlows; previous: Record<string, FlowResult> }): Promise<void> {
  const { inbound, previous } = args;
  try {
    await db.from("trigger_fires").delete().eq("workspace_id", inbound.workspace_id).like("dedupe_key", `${webhookDedupePrefix(inbound.id)}%`);
    for (const [flowId, result] of Object.entries(previous)) {
      if (result.contact_id) {
        await db.from("trigger_fires").delete().eq("workspace_id", inbound.workspace_id).eq("dedupe_key", webhookContactKey(flowId, result.contact_id));
      }
    }
    await db
      .from("flow_sessions")
      .update({ status: "cancelled" })
      .eq("inbound_webhook_id" as never, inbound.id)
      .eq("status", "active");
  } catch (err) {
    console.error("[hooks] no pude soltar las claves del envío:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Un reproceso de un flujo que YA corrió: no se repite el flujo (nada de mensajes), pero el contacto se vuelve a
 * mapear con el paso «Crear o actualizar contacto» actual (es idempotente: encuentra al mismo contacto, completa
 * lo que falte según su modo, y el toque ya existe). Solo cuando el flujo tiene UN paso de esos: con varios
 * (en ramas distintas) no se sabe cuál corrió. Nunca lanza.
 */
async function remapContact(
  db: Db,
  args: { flow: FlowOfTrigger; inbound: InboundForFlows; endpoint: EndpointForFlows; previous: FlowResult | undefined },
): Promise<FlowResult | null> {
  const { flow, inbound, endpoint, previous } = args;
  try {
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as { id: string; type: string; data?: unknown }[]) : [];
    const upserts = nodes.filter((n) => n.type === "upsert_contact");
    if (upserts.length !== 1) return null;
    const node = upserts[0];

    const outcome = await upsertContactFromWebhook({
      db,
      workspaceId: inbound.workspace_id,
      config: parseUpsertContactConfig(node.data),
      webhook: {
        inboundId: inbound.id,
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        payload: inbound.payload ?? {},
        query: inbound.query ?? {},
        receivedAt: inbound.received_at,
      },
      nodeId: node.id,
    });

    const base: FlowResult = { ...(previous ?? { status: "completed" as const }), flow_name: flow.name, contact_remapped: true };
    if (!outcome.ok) {
      return { ...base, contact_fail_reason: outcome.reason, notes: outcome.notes.length > 0 ? outcome.notes : null };
    }
    return {
      ...base,
      ...contactStepToResult({
        contactId: outcome.contactId,
        contactName: outcome.contactName,
        result: outcome.result,
        failReason: null,
        diff: Object.keys(outcome.diff).length > 0 ? outcome.diff : null,
        conflict: outcome.conflict,
        touch: outcome.touch,
        notes: outcome.notes,
      }),
    };
  } catch (err) {
    console.error("[hooks] no pude volver a mapear el contacto:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

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
    source: { type: "webhook", id: inbound.id },
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
