/**
 * «Crear o actualizar contacto» (Extra L, F12): el paso que le da un contacto a un flujo disparado por
 * un webhook. Busca por teléfono, email o red (nunca por nombre), crea o actualiza, suma tags y campos,
 * anota el toque de atribución y deja el historial. La lógica vive en `lib/webhooks/upsert-contact.ts`.
 *
 * - `needsContact: false`: no necesita un contacto para correr, lo CONSIGUE. Dos salidas: «Listo»
 *   (`handle:ok`) y «No se pudo» (`handle:fail`, con `contact_fail_reason` = `no_identifier` | `not_found`).
 * - Después del paso, `context.contactId` es el contacto: `{{contact.*}}` queda disponible y los pasos que
 *   lo necesitan corren. Se guarda también en `flow_sessions.contact_id`, así sobrevive a un «Esperar».
 *   Si el flujo ya tenía contacto (otro disparador), lo reemplaza para los pasos siguientes.
 * - Un fallo interno de base LANZA (el envío queda `error` y se puede reprocesar); «No se pudo» no es un
 *   error: es una salida del flujo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext } from "../types";
import { upsertContactOutputs } from "../node-outputs";
import { upsertContactFromWebhook } from "@/lib/webhooks/upsert-contact";
import { parseUpsertContactConfig } from "@/lib/webhooks/upsert-config";
import { webhookContactKey } from "@/lib/webhooks/trigger-config";

export type UpsertContactNodeData = Record<string, unknown> & { label?: string };

interface WebhookVars {
  id?: string;
  endpoint_id?: string;
  endpoint_name?: string;
  payload?: unknown;
  query?: unknown;
  received_at?: string;
  /** «Correr una sola vez por contacto» encendido en el disparador (viaja en las variables del envío). */
  once_per_contact?: boolean;
  trigger_id?: string;
}

/**
 * Para que los pasos que mandan mensajes funcionen después del paso, el flujo toma la conversación más
 * reciente del contacto (igual que un flujo de agenda o del CRM). Un contacto recién creado no tiene
 * ninguna: sigue sin poder mandar por un canal, y esos pasos se saltean con motivo.
 */
async function adoptLatestConversation(supabase: SupabaseClient<Database>, context: FlowExecutionContext, contactId: string): Promise<{ channelId: string } | null> {
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, channel_id, late_conversation_id")
    .eq("contact_id", contactId)
    .is("deleted_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  context.platform = undefined;
  context.lateAccountId = undefined;
  context.lateConversationId = undefined;
  if (!conversation) {
    context.channelId = "";
    context.conversationId = "";
    return null;
  }
  context.channelId = conversation.channel_id;
  context.conversationId = conversation.id;
  context.lateConversationId = conversation.late_conversation_id ?? undefined;
  const { data: channel } = await supabase.from("channels").select("platform, late_account_id").eq("id", conversation.channel_id).maybeSingle();
  if (channel) {
    context.platform = channel.platform as FlowExecutionContext["platform"];
    context.lateAccountId = channel.late_account_id ?? undefined;
  }
  return { channelId: conversation.channel_id };
}

/** Lo que queda anotado en el historial del envío cuando «una sola vez por contacto» frena la corrida. */
export const ALREADY_PASSED_NOTE = "ya_paso_por_este_flujo";

/**
 * ¿Esta persona ya pasó por este flujo? Con «una sola vez por contacto» apagado, nunca. Encendido, la primera
 * vez reclama la marca (`trigger_fires`, índice único) y las siguientes la encuentran tomada. Un error que no
 * sea «ya existe» se lanza: no se puede asegurar que sea la primera vez, y seguir podría repetir un mensaje.
 */
async function alreadyPassedThroughFlow(
  supabase: SupabaseClient<Database>,
  args: { webhook: WebhookVars; workspaceId: string; flowId: string; contactId: string },
): Promise<boolean> {
  if (args.webhook.once_per_contact !== true || !args.webhook.trigger_id) return false;
  const { error } = await supabase.from("trigger_fires").insert({
    trigger_id: args.webhook.trigger_id,
    workspace_id: args.workspaceId,
    dedupe_key: webhookContactKey(args.flowId, args.contactId),
    contact_id: args.contactId,
  } as never);
  if (!error) return false;
  if (error.code === "23505") return true;
  throw new Error(`no pude verificar si el contacto ya pasó por este flujo: ${error.message}`);
}

async function execute({ supabase, node, data, context, sessionId }: NodeExecutionArgs<UpsertContactNodeData, FlowExecutionContext>) {
  context.variables ??= {};
  const webhook = (context.variables.webhook ?? {}) as WebhookVars;
  const config = parseUpsertContactConfig(data);

  const outcome = await upsertContactFromWebhook({
    db: supabase,
    workspaceId: context.workspaceId,
    config,
    webhook: {
      inboundId: webhook.id ?? context.inboundWebhookId ?? "",
      endpointId: webhook.endpoint_id ?? "",
      endpointName: webhook.endpoint_name ?? "Webhook",
      payload: webhook.payload ?? {},
      query: webhook.query ?? {},
      receivedAt: webhook.received_at ?? null,
    },
    nodeId: node.id,
  });

  if (!outcome.ok) {
    context.variables.contact_result = "";
    context.variables.contact_fail_reason = outcome.reason;
    try {
      context.onContactStep?.({ contactId: null, contactName: null, result: null, failReason: outcome.reason, diff: null, conflict: null, touch: null, notes: outcome.notes });
    } catch {
      // Un aviso que falla no frena el flujo.
    }
    return "handle:fail";
  }

  context.contactId = outcome.contactId;
  context.variables.contact_result = outcome.result;
  context.variables.contact_fail_reason = "";

  // El contacto y la conversación quedan en la sesión: una espera posterior los conserva.
  const adopted = await adoptLatestConversation(supabase, context, outcome.contactId);
  const { error: sessionError } = await supabase
    .from("flow_sessions")
    .update({ contact_id: outcome.contactId, channel_id: adopted?.channelId ?? null, variables: context.variables as never })
    .eq("id", sessionId);
  // Si no se pudo guardar, un «Esperar» posterior perdería el contacto y el flujo seguiría como si nada:
  // se lanza y el motor lo trata como cualquier fallo del paso (el envío queda en error con el motivo).
  if (sessionError) throw new Error(`no pude guardar el contacto en la sesión del flujo: ${sessionError.message}`);

  // «Correr una sola vez por contacto» (Tirón 2, C2): el contacto ya quedó creado o actualizado (un envío nuevo
  // puede traer datos nuevos), pero si esta persona ya pasó por ESTE flujo, el flujo no se ejecuta otra vez.
  if (await alreadyPassedThroughFlow(supabase, { webhook, workspaceId: context.workspaceId, flowId: context.flowId, contactId: outcome.contactId })) {
    await supabase.from("flow_sessions").update({ status: "completed" }).eq("id", sessionId).eq("status", "active");
    try {
      context.onContactStep?.({
        contactId: outcome.contactId,
        contactName: outcome.contactName,
        result: outcome.result,
        failReason: null,
        diff: Object.keys(outcome.diff).length > 0 ? outcome.diff : null,
        conflict: outcome.conflict,
        touch: outcome.touch,
        notes: [...outcome.notes, ALREADY_PASSED_NOTE],
      });
    } catch {
      // Un aviso que falla no frena el flujo.
    }
    return "pause";
  }

  try {
    context.onContactStep?.({
      contactId: outcome.contactId,
      contactName: outcome.contactName,
      result: outcome.result,
      failReason: null,
      diff: Object.keys(outcome.diff).length > 0 ? outcome.diff : null,
      conflict: outcome.conflict,
      touch: outcome.touch,
      notes: outcome.notes,
    });
  } catch {
    // Un aviso que falla no frena el flujo.
  }
  return "handle:ok";
}

export const upsertContactNode: NodeDefinition<UpsertContactNodeData> = {
  needsContact: false,
  type: "upsert_contact",
  label: "Crear o actualizar contacto",
  // Qué pasó con el contacto y por qué no se pudo: los caminos condicionales lo pueden comparar.
  outputs: () => upsertContactOutputs(),
  execute,
};
