/**
 * Poner un WhatsApp de una automatización en la cola de su número. Solo servidor. Nunca lanza.
 *
 * Lo usan los pasos de WhatsApp («Enviar mensaje» por un WhatsApp de Evolution, «Enviar WhatsApp a un número», «Enviar al
 * grupo» y la votación a un grupo) en dos tiempos:
 *   1. `decideWhatsappDelivery`: ¿este paso sale al instante (el camino de siempre, sin tocar) o por la cola? Lo decide
 *      el paso (`data.delivery.mode`) o, en `auto`, el disparador publicado de la automatización (`settings.ts`).
 *   2. `enqueueWhatsapp`: la fila de la cola, con el texto ya armado y congelado, su prioridad, su caducidad, su
 *      programación y su límite por hora. La saca el despachador (`run-queue.ts`) de a una por número.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, SendQueuePriority, SendQueueStatus, SendQueueTargetKind } from "@/lib/types/database";
import type { FlowExecutionContext, FlowNode } from "@/lib/flow-engine/types";
import { businessTimeZone } from "@/lib/scheduled-flows/jobs";
import { formatInTz } from "@/lib/scheduling/time/tz";
import { expiresAtFor } from "./expiry";
import { dedupeKey } from "./dedupe";
import { hourStart, perRunPlacement } from "./per-run";
import { initialStatus, scheduledForFrom } from "./schedule";
import { DEFAULT_QUEUE_SETTINGS, parseDelivery, parseQueueSettings, PRIORITY_LABELS, resolveDeliveryMode, type DeliveryConfig, type QueueSettings } from "./settings";
import type { QueuePayload } from "./deliver";

type Db = SupabaseClient<Database>;

export type EnqueueTarget =
  /** La conversación del contacto de la ejecución. */
  | { kind: "conversation"; conversationId: string; contactId: string | null; channelId: string }
  /** Un número suelto («Enviar WhatsApp a un número»). */
  | { kind: "number"; phone: string; channelId: string; contactId: string | null }
  /** Un grupo: el número es el del grupo. */
  | { kind: "group"; groupId: string; channelId: string; label: string | null };

export interface WhatsappDeliveryDecision {
  mode: "queue" | "immediate";
  delivery: DeliveryConfig;
  settings: QueueSettings;
}

/** El disparador y la configuración de la cola de la automatización, leídos de la versión PUBLICADA (`flows.nodes`). */
export async function loadFlowQueueInfo(
  db: Db,
  flowId: string | null | undefined,
): Promise<{ found: boolean; triggerType: string | null; settings: QueueSettings }> {
  if (!flowId) return { found: false, triggerType: null, settings: DEFAULT_QUEUE_SETTINGS };
  const { data, error } = await db.from("flows").select("nodes").eq("id", flowId).maybeSingle();
  if (error) throw new Error(`No pude leer la automatización: ${error.message}`);
  if (!data) return { found: false, triggerType: null, settings: DEFAULT_QUEUE_SETTINGS };
  const nodes = (Array.isArray(data.nodes) ? data.nodes : []) as unknown as FlowNode[];
  const trigger = nodes.find((n) => n?.type === "trigger");
  const td = trigger?.data as { whatsappQueue?: unknown; triggerType?: unknown } | undefined;
  return { found: true, triggerType: typeof td?.triggerType === "string" ? td.triggerType : null, settings: parseQueueSettings(td?.whatsappQueue) };
}

/**
 * ¿Este paso sale al instante o por la cola? Sin automatización (un simulacro), si no se encuentra o si no se puede leer,
 * al instante: lo de siempre. Nunca lanza.
 */
export async function decideWhatsappDelivery(
  db: Db,
  flowId: string | null | undefined,
  rawDelivery: unknown,
  opts: { groupStep?: boolean } = {},
): Promise<WhatsappDeliveryDecision> {
  const delivery = parseDelivery(rawDelivery);
  if (!flowId) return { mode: "immediate", delivery, settings: DEFAULT_QUEUE_SETTINGS };
  try {
    const info = await loadFlowQueueInfo(db, flowId);
    if (!info.found) return { mode: delivery.mode === "queue" ? "queue" : "immediate", delivery, settings: DEFAULT_QUEUE_SETTINGS };
    return { mode: resolveDeliveryMode(delivery, info.triggerType, opts), delivery, settings: info.settings };
  } catch (e) {
    console.error("[send-queue] no pude leer la automatización, mando al instante:", e instanceof Error ? e.message : "error");
    return { mode: "immediate", delivery, settings: DEFAULT_QUEUE_SETTINGS };
  }
}

export interface EnqueueArgs {
  supabase: Db;
  context: Pick<FlowExecutionContext, "workspaceId" | "flowId" | "noteStep">;
  sessionId: string;
  node: Pick<FlowNode, "id">;
  /** La posición del mensaje dentro del paso (un paso puede mandar varios). */
  index: number;
  target: EnqueueTarget;
  payload: QueuePayload;
  decision: WhatsappDeliveryDecision;
  /** Reloj inyectable (pruebas). */
  now?: Date;
}

export type EnqueueResult =
  | { status: "queued" | "scheduled" | "overdue"; itemId: string }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

async function clientLabelOf(db: Db, contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await db.from("contacts").select("display_name").eq("id", contactId).maybeSingle();
  return data?.display_name?.slice(0, 200) ?? null;
}

export function previewOf(p: QueuePayload): string | null {
  if (p.poll) return `📊 ${p.poll.name}`.slice(0, 300);
  const text = (p.text ?? "").trim();
  if (text) return text.slice(0, 300);
  if (p.mediaUrl || p.groupMedia) return "📎 Archivo";
  return null;
}

export async function enqueueWhatsapp(args: EnqueueArgs): Promise<EnqueueResult> {
  const { supabase: db, context, node, sessionId, target } = args;
  const { delivery, settings } = args.decision;
  const now = args.now ?? new Date();
  try {
    const tz = await businessTimeZone(db, context.workspaceId);
    const channelId = target.channelId;
    const targetKind: SendQueueTargetKind = target.kind;

    // 1. La fecha y el estado con el que nace.
    const s = delivery.schedule;
    let scheduledFor = s.enabled ? scheduledForFrom(now, s) : now;
    const status: SendQueueStatus = initialStatus(scheduledFor, now, s.enabled);

    // 2. El límite por hora de la automatización: solo lo que ya puede salir.
    if (status === "queued" && settings.perRunLimit !== null && context.flowId) {
      const { count } = await db
        .from("send_queue_items")
        .select("id", { count: "exact", head: true })
        .eq("flow_id", context.flowId)
        .eq("channel_id", channelId)
        .gte("scheduled_for", hourStart(now).toISOString());
      scheduledFor = perRunPlacement(settings.perRunLimit, count ?? 0, now);
    }

    // 3. La caducidad, desde que puede salir.
    const expiresAt = expiresAtFor(settings.expiry, scheduledFor);
    const priority: SendQueuePriority = settings.priority;

    // 4. La clave de un solo envío: paso + ejecución + destino + vuelta (un menú que se vuelve a mostrar es otra vuelta).
    const targetKey = target.kind === "conversation" ? target.conversationId : target.kind === "group" ? target.groupId : target.phone;
    const base = { flowId: context.flowId || "sin-flujo", nodeId: node.id, index: args.index, sessionId: sessionId || `sin-sesion-${crypto.randomUUID()}`, targetKey };
    const { count: visits } = await db
      .from("send_queue_items")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", context.workspaceId)
      .like("dedupe_key", `${dedupeKey({ ...base, visit: 0 })}%`);

    const contactId = target.kind === "group" ? null : target.contactId;
    const row = {
      workspace_id: context.workspaceId,
      channel_id: channelId,
      flow_id: context.flowId || null,
      flow_session_id: sessionId || null,
      node_id: node.id,
      target_kind: targetKind,
      conversation_id: target.kind === "conversation" ? target.conversationId : null,
      whatsapp_group_id: target.kind === "group" ? target.groupId : null,
      to_number: target.kind === "number" ? target.phone : null,
      payload: args.payload as unknown as Json,
      preview: previewOf(args.payload),
      client_label: target.kind === "group" ? target.label?.slice(0, 200) ?? null : await clientLabelOf(db, contactId),
      priority,
      status,
      attempts: 0,
      reason_code: status === "overdue" ? "overdue" : null,
      reason: status === "overdue" ? "Nació con la fecha ya pasada: no se envía." : null,
      anchor_at: s.enabled ? now.toISOString() : null,
      schedule: s.enabled ? (s as unknown as Json) : null,
      scheduled_for: scheduledFor.toISOString(),
      expires_at: status === "overdue" ? null : (expiresAt?.toISOString() ?? null),
      dedupe_key: dedupeKey({ ...base, visit: visits ?? 0 }),
    };
    const { data: inserted, error } = await db.from("send_queue_items").insert(row).select("id").maybeSingle();
    if (error || !inserted) {
      if (error?.code === "23505") {
        context.noteStep?.({ status: "skipped", reason: "Este WhatsApp ya estaba en la cola para esta ejecución: no se repite." });
        return { status: "duplicate" };
      }
      console.error("[send-queue] no pude encolar:", error?.message ?? "sin fila");
      context.noteStep?.({ status: "failed", reason: "No pude poner el WhatsApp en la cola." });
      return { status: "skipped", reason: "No pude poner el WhatsApp en la cola." };
    }

    if (status === "overdue") {
      context.noteStep?.({ status: "skipped", reason: "El WhatsApp programado nació con la fecha ya pasada: quedó vencido y no se envía." });
    } else {
      const when =
        status === "scheduled"
          ? `programado para el ${formatInTz(scheduledFor, tz, "DD/MM HH:mm")}`
          : scheduledFor > now
            ? `previsto a partir del ${formatInTz(scheduledFor, tz, "DD/MM HH:mm")}`
            : "en la cola del número";
      context.noteStep?.({ status: "ok", reason: `WhatsApp ${when} · prioridad ${PRIORITY_LABELS[priority].toLowerCase()}.` });
    }
    return { status: status as "queued" | "scheduled" | "overdue", itemId: inserted.id };
  } catch (e) {
    console.error("[send-queue] algo falló al encolar:", e instanceof Error ? e.message : "error");
    context.noteStep?.({ status: "failed", reason: "Algo falló al poner el WhatsApp en la cola." });
    return { status: "skipped", reason: "Algo falló al poner el WhatsApp en la cola." };
  }
}
