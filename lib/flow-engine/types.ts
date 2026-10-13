import type { NodeType, Platform } from "@/lib/types/database";
import type { BranchNodeData } from "./condition-eval";

export type { BranchNodeData };

export interface FlowNode {
  id: string;
  type: NodeType;
  data: NodeData;
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export type NodeData =
  | TriggerNodeData
  | SendMessageNodeData
  | ConditionNodeData
  | BranchNodeData
  | DelayNodeData
  | TagNodeData
  | SetFieldNodeData
  | HttpRequestNodeData
  | GoToFlowNodeData
  | HumanTakeoverNodeData
  | ABSplitNodeData
  | SmartDelayNodeData
  | SubscribeNodeData
  | CommentReplyNodeData
  | PrivateReplyNodeData
  | AiResponseNodeData
  | EnrollSequenceNodeData;

export interface TriggerNodeData {
  triggerType: string;
  keywords?: Array<{
    value: string;
    matchType: "exact" | "contains" | "startsWith";
  }>;
  payload?: string;
}

export interface SendMessageNodeData {
  messages: Array<{
    text?: string;
    imageUrl?: string;
    quickReplies?: Array<{ title: string; payload: string }>;
    buttons?: Array<{
      title: string;
      type: "postback" | "url";
      payload?: string;
      url?: string;
    }>;
    carousel?: {
      elements: Array<{
        imageUrl?: string;
        title: string;
        subtitle?: string;
        buttons?: Array<{
          type: "postback" | "url";
          title: string;
          payload?: string;
          url?: string;
        }>;
      }>;
    };
  }>;
}

export interface ConditionNodeData {
  conditions: Array<{
    field: string;
    operator: "equals" | "not_equals" | "contains" | "exists" | "gt" | "lt";
    value: string;
  }>;
  logic: "and" | "or";
}

export interface DelayNodeData {
  duration: number;
  unit: "seconds" | "minutes" | "hours" | "days";
}

export interface TagNodeData {
  action: "add" | "remove";
  tagName: string;
}

export interface SetFieldNodeData {
  fieldSlug: string;
  value: string;
}

export interface HttpRequestNodeData {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  responseVariable?: string;
}

export interface GoToFlowNodeData {
  flowId: string;
  returnAfter: boolean;
}

export interface HumanTakeoverNodeData {
  message?: string;
}

export interface ABSplitNodeData {
  paths: Array<{ name: string; weight: number }>;
}

export interface SmartDelayNodeData {
  timeout: number;
  timeoutUnit: "minutes" | "hours" | "days";
}

export interface SubscribeNodeData {
  action: "subscribe" | "unsubscribe";
}

export interface CommentReplyNodeData {
  /** Text to reply to the comment with. Supports {{variable}} interpolation. */
  text: string;
}

export interface PrivateReplyNodeData {
  /** Text to send as a private DM to the commenter. Supports {{variable}} interpolation. */
  text: string;
  imageUrl?: string;
}

export interface AiResponseNodeData {
  /**
   * Proveedor de IA a usar (openai | anthropic | google_ai).
   *
   * Opcional: si no se elige, o si el elegido no esta conectado, se usa el que
   * si lo este. Mejor contestar con otro modelo que no contestar.
   */
  provider?: string;
  label?: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextMessages: number;
  /**
   * The generated text is always stored in the ai_response variable. When false,
   * the node ONLY stores it (no send), so a later Send Message node can use
   * {{ai_response}} without double-sending. Defaults to true for back-compat.
   */
  sendDirectly?: boolean;
}

export interface EnrollSequenceNodeData {
  /** The ID of the sequence to enroll the contact into */
  sequenceId: string;
}

/** Lo que el paso de contacto le cuenta a quien arrancó el flujo (ver `onContactStep`). */
export interface ContactStepInfo {
  contactId: string | null;
  contactName: string | null;
  result: "created" | "updated" | "unchanged" | null;
  failReason: string | null;
  diff: Record<string, { before: unknown; after: unknown }> | null;
  conflict: { contact_id: string; by: string }[] | null;
  touch: { recorded: boolean; source: string; medium: string | null; campaign: string | null; content: string | null; ad_id: string | null } | null;
  notes: string[];
}

export interface FlowExecutionContext {
  triggerId: string;
  flowId: string;
  /**
   * Vacío cuando el flow no arrancó por un canal: un evento de agenda o del
   * CRM sobre un contacto sin conversación. Los nodos que envían por un canal
   * se saltean con motivo; `send_email` no lo necesita.
   */
  channelId: string;
  /**
   * El contacto del flujo. `null` en un flujo SIN contacto ("sobre una persona del
   * equipo", E15): un reporte de fin de día es de alguien del equipo, no de un lead.
   * Los nodos que necesitan contacto (`needsContact`) nunca corren sin uno: el motor
   * los saltea y lo anota.
   */
  contactId: string | null;
  /** La persona del equipo de un flujo sin contacto (quien envió el reporte). */
  memberUserId?: string | null;
  /**
   * El envío de webhook que arrancó el flujo (disparador `webhook_received`). El flujo arranca
   * sin contacto y sin persona: el paso "Crear o actualizar contacto" pone `contactId` después.
   */
  inboundWebhookId?: string | null;
  /**
   * Un aviso para quien arrancó el flujo cuando el motor saltea un paso por falta de contacto
   * (los flujos de webhook lo anotan en el historial del envío). Nunca lanza.
   */
  onStepSkipped?: (step: { nodeId: string; nodeType: string; label: string }) => void;
  /**
   * Lo que pasó en el paso «Crear o actualizar contacto» (el contacto, el diff, el conflicto, el toque):
   * los flujos de webhook lo guardan en el historial del envío. Nunca lanza.
   */
  onContactStep?: (info: ContactStepInfo) => void;
  conversationId: string;
  workspaceId: string;
  /** The Zernio API conversation ID (from conversations.late_conversation_id) */
  lateConversationId?: string;
  /** The Zernio API account ID (from channels.late_account_id) */
  lateAccountId?: string;
  incomingMessage: IncomingMessage;
  /**
   * Lo único que sobrevive a un Delay: la sesión las guarda en jsonb. Por eso
   * las variables de agenda y la marca `trigger_scope` viajan acá y no en un
   * campo aparte del contexto, que al retomar llega vacío.
   */
  variables?: Record<string, unknown>;
  platform?: Platform;
}

/** El contexto de un flujo CON contacto: lo que reciben los nodos que lo necesitan. */
export type ContactFlowContext = FlowExecutionContext & { contactId: string };

/**
 * El contacto de un flujo, para lo que solo tiene sentido con uno (las secuencias, las
 * agendas o las ventas DEL contacto). En un flujo sin contacto lanza: una condición sobre
 * eso "no se cumple", nunca rompe el flujo (el nodo Condiciones atrapa el error).
 */
export function requireContactId(context: Pick<FlowExecutionContext, "contactId">): string {
  if (!context.contactId) throw new Error("Este flujo no tiene contacto");
  return context.contactId;
}

/**
 * El mensaje que disparo la ejecucion.
 *
 * Estaba escrito adentro de FlowExecutionContext; se le puso nombre porque el
 * registro de triggers lo necesita para declarar sus handlers de match.
 */
export interface IncomingMessage {
  text?: string;
  postbackPayload?: string;
  quickReplyPayload?: string;
  callbackData?: string;
  sender?: { id: string; name?: string; username?: string };
  /**
   * True cuando el mensaje es una respuesta a una historia de Instagram.
   *
   * Zernio lo manda en metadata.storyReply. Es lo que permite el filtro "es
   * respuesta a historia" del trigger de palabra clave (F6): responder una
   * historia es una señal de interes bastante mas fuerte que un DM suelto, y
   * merece su propia automatizacion.
   */
  isStoryReply?: boolean;
  /** Id de la historia respondida, cuando lo hay. */
  storyId?: string;
}
