import type { Database } from "@/lib/types/database";

/**
 * Origen de un saliente (F2, Bloque 1). Es la respuesta a "de dónde salió este
 * mensaje", que hasta ahora no se guardaba: los 1.580 salientes del historial
 * entraron sin autor (ver docs/diagnostico-autoria.md). Cada camino de envío
 * ahora declara su origen acá, en un solo lugar, para que el dashboard del
 * Bloque 3 pueda agrupar por autor.
 *
 * - `agent`     el agente de IA (envío directo o borrador aprobado)
 * - `user`      una persona desde la bandeja
 * - `flow`      un nodo de un flow
 * - `sequence`  un paso de una secuencia (drip)
 * - `broadcast` un envío masivo
 * - `external`  cualquier cosa que no salió de la app: ManyChat, la app de
 *               Instagram, el eco de WhatsApp. Traído por el historial o el
 *               refresco contra Zernio. Nunca tiene autor propio.
 */
export const OUTBOUND_ORIGINS = [
  "agent",
  "user",
  "flow",
  "sequence",
  "broadcast",
  "external",
] as const;

export type OutboundOrigin = (typeof OUTBOUND_ORIGINS)[number];

type MessageInsert = Database["public"]["Tables"]["messages"]["Insert"];

export interface OutboundRowInput {
  conversationId: string;
  origin: OutboundOrigin;
  text: string;
  status: MessageInsert["status"];
  attachments?: unknown[] | null;
  platformMessageId?: string | null;
  platformNativeMessageId?: string | null;
  sentByUserId?: string | null;
  sentByAgentId?: string | null;
  sentByFlowId?: string | null;
  sentByNodeId?: string | null;
  agentRunId?: string | null;
  /** Se omite si no se pasa: la base pone now() por defecto. */
  createdAt?: string | null;
  /** Se omite si no se pasa: lo completa el trigger messages_fill_workspace_id. */
  workspaceId?: string | null;
}

/**
 * Chequeo de coherencia entre el origen y los campos de autoría. Un `external`
 * nunca puede tener autor propio; un `user` sin `sent_by_user_id` o un `agent`
 * sin `sent_by_agent_id` es un bug del camino que llama. No corre en el camino
 * de envío (nunca puede hacer fallar un envío que ya salió): lo usan los tests.
 */
export function originConsistencyError(input: OutboundRowInput): string | null {
  const hasAuthor =
    input.sentByAgentId != null ||
    input.sentByFlowId != null ||
    input.sentByNodeId != null ||
    input.agentRunId != null;
  switch (input.origin) {
    case "external":
      if (hasAuthor || input.sentByUserId != null) {
        return "un saliente external no puede tener autor propio";
      }
      return null;
    case "user":
      return input.sentByUserId ? null : "un saliente user necesita sent_by_user_id";
    case "agent":
      return input.sentByAgentId ? null : "un saliente agent necesita sent_by_agent_id";
    case "flow":
      return input.sentByFlowId ? null : "un saliente flow necesita sent_by_flow_id";
    // `sequence` manda con sent_by_flow_id nulo (la FK apunta a flows y el paso
    // no es un flow), así que no se exige autor. `broadcast` tampoco tiene
    // columna propia todavía: se distingue solo por el origin.
    case "sequence":
    case "broadcast":
      return null;
  }
}

/**
 * Arma la fila de un saliente para insertar en `messages` con su `origin`
 * explícito. Única fuente de la autoría de salientes: todos los caminos de
 * envío pasan por acá. Solo incluye las claves que se pasan, para no pisar los
 * defaults de la base (`created_at`, `workspace_id`).
 */
export function outboundMessageRow(input: OutboundRowInput): MessageInsert {
  const row: MessageInsert = {
    conversation_id: input.conversationId,
    direction: "outbound",
    text: input.text,
    origin: input.origin,
    status: input.status,
    sent_by_agent_id: input.sentByAgentId ?? null,
    sent_by_user_id: input.sentByUserId ?? null,
    sent_by_flow_id: input.sentByFlowId ?? null,
    sent_by_node_id: input.sentByNodeId ?? null,
    agent_run_id: input.agentRunId ?? null,
    platform_message_id: input.platformMessageId ?? null,
    platform_native_message_id: input.platformNativeMessageId ?? null,
    attachments: (input.attachments as never) ?? null,
  };
  if (input.createdAt != null) row.created_at = input.createdAt;
  if (input.workspaceId != null) row.workspace_id = input.workspaceId;
  return row;
}
