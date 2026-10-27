import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { ContactFlowContext, FlowNode, FlowEdge, FlowExecutionContext } from "./types";
import { getNode } from "./registry";
import { messageOriginVariables } from "@/lib/messages/origin-context";
import { seedContactVariables } from "./variable-catalog";
import type { AutomationSource, FlowRuntime } from "./registry/types";

/**
 * Lo que el motor le presta a los nodos que necesitan arrancar otro flow.
 *
 * Va por parametro y no por import para que el registro pueda importar los
 * nodos sin que los nodos importen al motor.
 */
const runtime: FlowRuntime = {
  executeFlow: async (supabase, context) => {
    await executeFlow(supabase, context);
  },
};

type FlowSessionRow = Database["public"]["Tables"]["flow_sessions"]["Row"];

/**
 * La sesion de flow que esta esperando la respuesta de este contacto en este
 * canal (un "Esperar respuesta"), si hay una.
 *
 * Esta afuera de executeFlow porque el receptor de mensajes la necesita ANTES
 * de buscar triggers: una conversacion parada esperando respuesta tiene que
 * despertar con el proximo mensaje aunque ese mensaje no matchee ningun
 * trigger. Antes el chequeo vivia solo aca adentro, despues del matcher, y la
 * sesion quedaba dormida si nadie la reclamaba.
 *
 * Si hubiera mas de una esperando (no deberia), se toma la mas reciente en vez
 * de fallar: con .single() una duplicada hacia que no se retomara ninguna.
 */
export async function findWaitingSession(
  supabase: SupabaseClient<Database>,
  { contactId, channelId }: { contactId: string | null; channelId: string }
): Promise<FlowSessionRow | null> {
  // Sin canal no hay sesión que retomar: un mensaje entrante siempre llega por
  // uno, y una sesión sin canal (agenda) no espera respuesta del contacto. Un
  // flujo sin contacto tampoco tiene canal.
  if (!channelId || !contactId) return null;

  const { data, error } = await supabase
    .from("flow_sessions")
    .select("*")
    .eq("contact_id", contactId)
    .eq("channel_id", channelId)
    .eq("status", "active")
    .eq("waiting_for_input", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[flow-engine] no pude buscar la sesion en espera:", error.message);
    return null;
  }
  return data ?? null;
}

export async function executeFlow(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext
) {
  // Ensure variables always exists so nodes (aiResponse, httpRequest) can write
  // outputs even when the trigger passed none (e.g. DM-triggered flows).
  // Una copia: quien llama puede reusar el mismo objeto para varios flujos (un evento que dispara dos), y la cadena de
  // saltos de un flujo no puede contaminar al siguiente.
  context.variables = { ...(context.variables ?? {}) };

  // Seed {{message}} from the incoming message text so the variable offered in
  // the builder resolves in production, not just in the simulator (which seeds
  // it itself). Guarded so cron resumes with an empty incomingMessage don't
  // clobber a previously stored value.
  if (context.incomingMessage.text) {
    context.variables.message ??= context.incomingMessage.text;
  }
  // El origen del mensaje (anuncio, mencion): `{{message_origin.ad_id}}`, `{{message_origin.ad_title}}`,
  // `{{message_origin.is_story_mention}}`. Aparte de `message`, que es solo el texto (Extra L, F19).
  const messageOrigin = messageOriginVariables({
    isStoryMention: context.incomingMessage.isStoryMention,
    adId: context.incomingMessage.adId,
    adTitle: context.incomingMessage.adTitle,
  });
  if (messageOrigin) context.variables.message_origin ??= messageOrigin;
  // La pieza de la que vino el mensaje (Extra I, F34): `{{content.title}}`, `{{content.code}}`. Un disparador de comentario
  // ya la trae en `variables.content`; no se pisa.
  if (context.incomingMessage.content) context.variables.content ??= context.incomingMessage.content;

  // Arrancar un flujo NO retoma una sesion en espera. Antes se buscaba aca una sesion parada en "Esperar respuesta" del
  // mismo contacto y canal y, si habia, se la retomaba en vez de arrancar este flujo: un evento (una etiqueta, una
  // reunion, una inactividad, un comentario) despertaba OTRA automatizacion con un mensaje vacio, y la que correspondia
  // se perdia para siempre (su `trigger_fires` ya estaba reclamado). Retomar con un mensaje entrante lo hace el receptor
  // (`lib/inbound.ts`), antes de buscar disparadores: es el unico lugar donde un mensaje es una respuesta.

  // Un salto entre flujos ("Ir a otro flujo") que vuelve a uno ya visitado es un ciclo: se corta (A -> B -> A mandaria
  // mensajes sin fin). La cadena viaja en las variables para sobrevivir a una pausa.
  const chain = flowChainOf(context.variables);
  if (chain.includes(context.flowId) || chain.length >= MAX_FLOW_JUMPS) {
    console.error(`[flow-engine] "Ir a otro flujo" formaria un ciclo o pasa de ${MAX_FLOW_JUMPS} saltos (flujo ${context.flowId}): se corta`);
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "flow_loop_blocked",
      metadata: { chainLength: chain.length },
    });
    return;
  }
  context.variables[FLOW_CHAIN_KEY] = [...chain, context.flowId];

  // Load flow. Siempre del workspace del contexto: "Ir a otro flujo" guarda un id, y sin este filtro podia correr un
  // flujo de OTRO negocio con los datos de este.
  const { data: flow } = await supabase
    .from("flows")
    .select("*")
    .eq("id", context.flowId)
    .eq("workspace_id", context.workspaceId)
    .eq("status", "published")
    .single();

  if (!flow) return;

  const nodes = flow.nodes as unknown as FlowNode[];
  const edges = flow.edges as unknown as FlowEdge[];

  // Los datos del contacto y del negocio como variables (`{{contact.display_name}}`, `{{workspace.name}}`), en TODOS
  // los pasos. Antes solo los resolvian Enviar mensaje, Enviar email y Enviar recurso (con una segunda pasada propia);
  // en una tarea, un aviso, una Llamada HTTP o el prompt de la IA quedaban como texto literal.
  context.variables = await withContactVariables(supabase, context.variables, context.contactId, context.workspaceId);

  // Get channel platform and late_account_id. Sin canal (agenda, formularios, webhooks) no se pregunta: un `id=""`
  // es un error de uuid que solo ensuciaba el log.
  if (context.channelId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("platform, late_account_id")
      .eq("id", context.channelId)
      .single();

    context.platform = channel?.platform as FlowExecutionContext["platform"];
    if (channel?.late_account_id && !context.lateAccountId) {
      context.lateAccountId = channel.late_account_id;
    }
  }

  // Resolve late_conversation_id from the conversation record if not already set
  if (!context.lateConversationId && context.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (conversation?.late_conversation_id) {
      context.lateConversationId = conversation.late_conversation_id;
    }
  }

  // Create session
  const { data: session } = await supabase
    .from("flow_sessions")
    .insert({
      contact_id: context.contactId,
      // Un flujo sin contacto es sobre una persona del equipo (00182).
      ...(context.contactId ? {} : { member_user_id: context.memberUserId ?? null }),
      // Un flujo de webhook arranca sin contacto ni persona: el envio es lo que lo sostiene (00187). // @plantilla-quitar(webhooks)
      ...(context.inboundWebhookId ? { inbound_webhook_id: context.inboundWebhookId } : {}), // @plantilla-quitar(webhooks)
      // Que lo disparo (00218). Sin declarar, la base lo completa segun el contacto, la persona o el envio.
      ...(context.source ? { source_type: context.source.type, source_id: context.source.id } : {}),
      flow_id: context.flowId,
      // Null y no cadena vacía: `channel_id` es una referencia a `channels`.
      // Antes el cron mandaba "" y el insert fallaba en silencio, así que un
      // contacto sin conversación no disparaba NINGÚN flow (migración 00100).
      channel_id: context.channelId || null,
      status: "active",
      variables: (context.variables ?? {}) as Json,
    })
    .select("id")
    .single();

  if (!session) return;

  // Track flow_started
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "flow_started",
    metadata: { triggerId: context.triggerId },
  });

  // Find the trigger node (entry point)
  const triggerNode = nodes.find((n) => n.type === "trigger");
  const firstEdge = triggerNode ? edges.find((e) => e.source === triggerNode.id) : undefined;
  const startNode = firstEdge ? nodes.find((n) => n.id === firstEdge.target) : undefined;
  // Un flujo sin disparador o con el disparador sin pasos conectados: la sesion se cierra (antes quedaba `active` para
  // siempre, y sumaba una sesion viva por cada vez que se disparaba).
  if (!startNode) {
    await completeSession(supabase, session.id);
    return;
  }

  await runTraversal(supabase, session.id, startNode, nodes, edges, context);
}

/** Lee y siembra las variables del contacto y del negocio. Un fallo de lectura no frena el flujo: siguen sin sembrar. */
async function withContactVariables(
  supabase: SupabaseClient<Database>,
  variables: Record<string, unknown>,
  contactId: string | null,
  workspaceId: string
): Promise<Record<string, unknown>> {
  try {
    const [contact, workspace] = await Promise.all([
      contactId
        ? supabase.from("contacts").select("display_name, email, phone").eq("id", contactId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
    ]);
    return seedContactVariables(
      variables,
      (contact.data as { display_name?: string | null; email?: string | null; phone?: string | null } | null) ?? null,
      (workspace.data as { name?: string | null } | null) ?? null
    );
  } catch (err) {
    console.error("[flow-engine] no pude leer los datos del contacto para las variables:", err instanceof Error ? err.message : "error");
    return variables;
  }
}

/** Cuantos saltos de "Ir a otro flujo" seguidos se permiten antes de cortar. */
const MAX_FLOW_JUMPS = 10;
/** La cadena de flujos visitados, en las variables (sobrevive a una pausa). */
const FLOW_CHAIN_KEY = "__flow_chain";

function flowChainOf(variables: Record<string, unknown> | undefined): string[] {
  const value = variables?.[FLOW_CHAIN_KEY];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Recorre los pasos y, si uno lanza, CANCELA la sesion y anota el fallo antes de devolver el error. Antes la sesion
 * quedaba `active` para siempre (nadie la despierta: no espera respuesta ni tiene un job), y el siguiente flujo del
 * contacto la encontraba en el medio.
 */
async function runTraversal(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  startNode: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  context: FlowExecutionContext
) {
  try {
    await traverseNodes(supabase, sessionId, startNode, nodes, edges, context, 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[flow-engine] el flujo ${context.flowId} fallo en la sesion ${sessionId}: ${message}`);
    await supabase.from("flow_sessions").update({ status: "cancelled" }).eq("id", sessionId).eq("status", "active");
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "flow_failed",
      metadata: { sessionId },
    });
    throw err;
  }
}

const MAX_TRAVERSAL_DEPTH = 50;

// Thrown before resumeSession advances current_node_id, so callers may retry
// without cancelling the session.
export class FlowLoadError extends Error {}

/**
 * Por que salida sigue una sesion retomada en un "Esperar respuesta": `reply` (llego un mensaje, la salida de siempre)
 * o `timeout` (vencio el tiempo maximo: la salida "Si no responde a tiempo"). Una pausa de "Esperar" no la usa.
 */
export type ResumeExit = "reply" | "timeout";

/** La salida del "Esperar respuesta" que se toma cuando vence el tiempo. */
export const WAIT_TIMEOUT_HANDLE = "timeout";

export async function resumeSession(
  supabase: SupabaseClient<Database>,
  session: Database["public"]["Tables"]["flow_sessions"]["Row"],
  context: FlowExecutionContext,
  exit: ResumeExit = "reply"
) {
  const { data: flow, error: flowError } = await supabase
    .from("flows")
    .select("*")
    .eq("id", session.flow_id)
    .single();

  if (!flow) {
    // postgrest-js swallows transient failures into { data: null, error }, it
    // does not throw. Only PGRST116 (zero rows) means the flow row is genuinely
    // gone; anything else is a transient DB/network blip, so throw and let the
    // caller recover (cron retry with backoff, or the contact's next message on
    // the webhook path) instead of permanently cancelling the session.
    if (flowError && flowError.code !== "PGRST116") {
      throw new FlowLoadError(
        `flow ${session.flow_id} could not be loaded: ${flowError.message}`
      );
    }
    await cancelUnresumableSession(
      supabase,
      session.id,
      `flow ${session.flow_id} no longer exists`
    );
    return;
  }

  // Un flujo despublicado (o archivado) no sigue: antes una sesion parada en un "Esperar" seguia corriendo despues de
  // apagar la automatizacion.
  if (flow.status !== "published") {
    await cancelUnresumableSession(supabase, session.id, `flow ${session.flow_id} is not published`);
    return;
  }

  // Retomar un "Esperar respuesta" es un reclamo: dos mensajes que llegan juntos (pasa seguido en Instagram) encontraban
  // los dos la misma sesion esperando y los dos corrian el resto del flujo, asi que todo salia dos veces. Ahora solo
  // sigue quien cambia `waiting_for_input` de true a false.
  if (session.waiting_for_input) {
    const { data: claimed, error: claimError } = await supabase
      .from("flow_sessions")
      .update({ waiting_for_input: false, waiting_until: null })
      .eq("id", session.id)
      .eq("status", "active")
      .eq("waiting_for_input", true)
      .select("id");
    if (claimError) throw new FlowLoadError(`session ${session.id} could not be claimed: ${claimError.message}`);
    if (!claimed || claimed.length === 0) return;
  }

  const nodes = flow.nodes as unknown as FlowNode[];
  const edges = flow.edges as unknown as FlowEdge[];

  if (context.channelId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("platform, late_account_id")
      .eq("id", context.channelId)
      .single();

    context.platform = channel?.platform as FlowExecutionContext["platform"];
    if (channel?.late_account_id && !context.lateAccountId) {
      context.lateAccountId = channel.late_account_id;
    }
  }

  // Resolve late_conversation_id if not set
  if (!context.lateConversationId && context.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", context.conversationId)
      .single();

    if (conversation?.late_conversation_id) {
      context.lateConversationId = conversation.late_conversation_id;
    }
  }

  // La SESION sabe de donde viene el flujo; el job de «Esperar» y el mensaje que despierta una espera no lo mandan.
  // Sin esto, un flujo de webhook o de sistema (sin contacto) que sigue despues de una pausa — y el flujo al que salta
  // «Ir a otro flujo» — perdia el envio y el origen: su sesion nueva no tenia contacto, persona ni envio y la base la
  // rechazaba, sin avisar. Con contacto no cambia nada: la sesion trae el mismo que ya traia el contexto.
  restoreOriginFromSession(context, session);

  context.variables = (session.variables as Record<string, string>) || {};

  // The resume is driven by a fresh reply; make {{message}} reflect it.
  if (context.incomingMessage.text) {
    context.variables.message = context.incomingMessage.text;
  }

  // Una pausa de "Esperar" (sin reclamo de arriba): se limpia la marca de tiempo, como siempre.
  if (!session.waiting_for_input) {
    await supabase
      .from("flow_sessions")
      .update({ waiting_for_input: false, waiting_until: null })
      .eq("id", session.id);
  }

  // Continue from current node
  const currentNode = nodes.find((n) => n.id === session.current_node_id);
  if (!currentNode) {
    // The flow was edited and the paused-on node removed; the session can
    // never advance, so settle it instead of leaving it active forever.
    await cancelUnresumableSession(
      supabase,
      session.id,
      `node ${session.current_node_id} no longer exists in flow ${session.flow_id}`
    );
    return;
  }

  // Get next node after the current one. Un "Esperar respuesta" tiene dos salidas: la de siempre (respondio) y
  // "Si no responde a tiempo" (`timeout`). Respondio nunca toma la de timeout; timeout solo toma la suya.
  const outgoing = edges.filter((e) => e.source === currentNode.id);
  // Vencido sin la salida "Si no responde a tiempo" conectada, sigue por la de siempre (lo que el panel prometia).
  const mainEdge = outgoing.find((e) => e.sourceHandle !== WAIT_TIMEOUT_HANDLE);
  const nextEdge = exit === "timeout" ? (outgoing.find((e) => e.sourceHandle === WAIT_TIMEOUT_HANDLE) ?? mainEdge) : mainEdge;
  if (!nextEdge) {
    await completeSession(supabase, session.id);
    return;
  }

  const nextNode = nodes.find((n) => n.id === nextEdge.target);
  if (!nextNode) {
    await completeSession(supabase, session.id);
    return;
  }

  await runTraversal(supabase, session.id, nextNode, nodes, edges, context);
}

/**
 * Lo que una reanudacion recupera de la sesion: el contacto, la persona, el envio de webhook y el origen. Solo
 * completa lo que el contexto NO trae (`??=`): nunca pisa algo que quien reanuda ya sabia.
 */
export function restoreOriginFromSession(
  context: FlowExecutionContext,
  session: Pick<Database["public"]["Tables"]["flow_sessions"]["Row"], "contact_id" | "member_user_id" | "inbound_webhook_id" | "source_type" | "source_id"> // @plantilla-quitar(webhooks)
  // @plantilla-sin(webhooks): session: Pick<Database["public"]["Tables"]["flow_sessions"]["Row"], "contact_id" | "member_user_id" | "source_type" | "source_id">
): void {
  context.contactId ??= session.contact_id;
  context.memberUserId ??= session.member_user_id;
  context.inboundWebhookId ??= session.inbound_webhook_id; // @plantilla-quitar(webhooks)
  if (!context.source && session.source_type) {
    context.source = { type: session.source_type as AutomationSource["type"], id: session.source_id ?? null };
  }
}

async function cancelUnresumableSession(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  reason: string
) {
  console.error(`Cancelling flow session ${sessionId}: ${reason}`);
  const { error } = await supabase
    .from("flow_sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId);
  if (error) {
    // postgrest swallows network failures into { error }, so an unchecked
    // cancel can silently no-op and strand the session as active forever.
    // current_node_id has not advanced, so FlowLoadError lets callers retry
    // and re-attempt the cancel.
    throw new FlowLoadError(
      `session ${sessionId} could not be cancelled (${reason}): ${error.message}`
    );
  }
}

async function traverseNodes(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  node: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  context: FlowExecutionContext,
  depth: number = 0
) {
  if (depth >= MAX_TRAVERSAL_DEPTH) {
    console.error(`Flow traversal exceeded max depth (${MAX_TRAVERSAL_DEPTH}), stopping. Flow: ${context.flowId}`);
    // Que quede anotado: un flujo de mas de 50 pasos seguidos (o un ciclo sin pausa) se cortaba sin que nadie se entere.
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "flow_depth_limit",
      metadata: { nodeId: node.id, limit: MAX_TRAVERSAL_DEPTH },
    });
    await completeSession(supabase, sessionId);
    return;
  }
  // Update current node
  await supabase
    .from("flow_sessions")
    .update({ current_node_id: node.id })
    .eq("id", sessionId);

  // Track analytics
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "node_executed",
    metadata: { nodeId: node.id, nodeType: node.type },
  });

  // Execute the node
  const result = await executeNode(supabase, node, context, sessionId);

  // Los nodos que escriben variables las guardan en la sesion para que
  // sobrevivan a una pausa (resumeSession las vuelve a leer de ahi). Cual lo
  // hace lo declara cada nodo en el registro; antes eran dos tipos escritos a
  // mano aca, y sumar un tercero implicaba acordarse de tocar el motor.
  if (getNode(node)?.persistsVariables) {
    await supabase
      .from("flow_sessions")
      .update({ variables: (context.variables ?? {}) as Json })
      .eq("id", sessionId);
  }

  // If the node pauses execution (delay, wait for input, human takeover), stop
  if (result === "pause") return;

  // Find next node(s)
  let nextEdge: FlowEdge | undefined;

  if (result && typeof result === "string" && result.startsWith("handle:")) {
    // Condition/split nodes specify which handle to follow
    const handle = result.replace("handle:", "");
    nextEdge = edges.find(
      (e) => e.source === node.id && edgeMatchesHandle(e.sourceHandle, handle)
    );
  } else {
    nextEdge = edges.find((e) => e.source === node.id);
  }

  if (!nextEdge) {
    await completeSession(supabase, sessionId);
    return;
  }

  const nextNode = nodes.find((n) => n.id === nextEdge!.target);
  if (!nextNode) {
    await completeSession(supabase, sessionId);
    return;
  }

  // Continue to next node
  await traverseNodes(supabase, sessionId, nextNode, nodes, edges, context, depth + 1);
}

/**
 * Ejecuta un nodo pidiendoselo al registro.
 *
 * El motor no sabe que tipos existen. Antes habia aca un switch con dieciocho
 * casos y un `default: return` que se comia en silencio todo lo que no
 * reconociera — que resulto ser los once nodos de accion del panel, porque el
 * canvas los guarda como `type: "action"` con el tipo real adentro de
 * `data.actionType`. Pasaban el panel de Test y en produccion no hacian nada.
 *
 * Ahora un nodo desconocido se avisa fuerte en vez de desaparecer.
 */
async function executeNode(
  supabase: SupabaseClient<Database>,
  node: FlowNode,
  context: FlowExecutionContext,
  sessionId: string
): Promise<string | void> {
  const definition = getNode(node);

  if (!definition) {
    console.error(
      `Nodo sin definicion en el registro (type="${node.type}", actionType="${
        (node.data as { actionType?: string } | undefined)?.actionType ?? "-"
      }"). El flow sigue de largo.`
    );
    return;
  }

  if (!definition.needsContact) {
    return definition.execute({ supabase, node, data: node.data as never, context, sessionId, runtime });
  }

  // Un flujo sin contacto (sobre una persona del equipo, E15) que llega a un paso que
  // necesita uno: se saltea, se anota y se sigue. Nunca lanza. El editor ya impide
  // agregar esos pasos: esto es la red de seguridad.
  if (!context.contactId) {
    console.warn(`[flow-engine] el nodo ${node.id} (${definition.type}) necesita un contacto y el flow ${context.flowId} no tiene: se saltea`);
    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: null,
      event_type: "node_skipped",
      metadata: { nodeId: node.id, nodeType: definition.type, reason: "Este paso necesita un contacto y este flujo no tiene" },
    });
    try {
      const label = (node.data as { label?: unknown } | undefined)?.label;
      context.onStepSkipped?.({ nodeId: node.id, nodeType: definition.type, label: typeof label === "string" && label.trim() ? label.trim() : definition.label });
    } catch {
      // Un aviso que falla no frena el flujo.
    }
    return;
  }

  return definition.execute({
    supabase,
    node,
    data: node.data as never,
    context: context as ContactFlowContext,
    sessionId,
    runtime,
  });
}

/**
 * Cierra un "Esperar respuesta" que vencio sin tiempo maximo configurado: no sigue por ninguna salida. Es un reclamo
 * (solo si sigue esperando), asi una respuesta que llega justo en el mismo momento gana o pierde limpio.
 */
export async function expireWaitingSession(supabase: SupabaseClient<Database>, sessionId: string, nodeId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("flow_sessions")
    .update({ waiting_for_input: false })
    .eq("id", sessionId)
    .eq("status", "active")
    .eq("waiting_for_input", true)
    .eq("current_node_id", nodeId)
    .select("id");
  if (error) throw new FlowLoadError(`session ${sessionId} could not be expired: ${error.message}`);
  if (!data || data.length === 0) return false;
  await completeSession(supabase, sessionId);
  return true;
}

async function completeSession(
  supabase: SupabaseClient<Database>,
  sessionId: string
) {
  // Only an active session can complete: a concurrent cancel (e.g. the cron's
  // stranded-session settle) must not be overwritten to completed. Zero rows
  // matched also skips the flow_completed analytics event below.
  const { data: session } = await supabase
    .from("flow_sessions")
    .update({ status: "completed" })
    .eq("id", sessionId)
    .eq("status", "active")
    .select("flow_id, contact_id, channel_id")
    .single();

  if (session) {
    const { data: flow } = await supabase
      .from("flows")
      .select("workspace_id")
      .eq("id", session.flow_id)
      .single();

    if (flow) {
      await supabase.from("analytics_events").insert({
        workspace_id: flow.workspace_id,
        flow_id: session.flow_id,
        contact_id: session.contact_id,
        event_type: "flow_completed",
      });
    }
  }
}

/**
 * Compara la salida que pidio el nodo con la que declara la arista.
 *
 * El nodo visual del canvas dibujaba sus salidas como "yes"/"no" mientras el
 * motor buscaba "true"/"false": una condicion armada a mano en el builder no
 * ramificaba nunca — la arista no se encontraba, nextEdge quedaba undefined y
 * el flow se cerraba en silencio. Solo funcionaban las de template, que ya
 * guardaban "true"/"false".
 *
 * El nodo ya usa los ids correctos. Esto acepta ademas los viejos para no
 * tener que migrar el jsonb de los flows que la gente ya dibujo.
 */
const HANDLE_ALIASES: Record<string, string> = { yes: "true", no: "false" };

function edgeMatchesHandle(sourceHandle: string | undefined, handle: string): boolean {
  if (!sourceHandle) return false;
  if (sourceHandle === handle) return true;
  return HANDLE_ALIASES[sourceHandle] === handle;
}
