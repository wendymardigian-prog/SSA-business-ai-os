/**
 * Contratos del registro de nodos, triggers y condiciones (F7).
 *
 * El motor no sabe que tipos de nodo existen. Sabe pedirle al registro el que
 * corresponde y ejecutarlo. Sumar un tipo nuevo es declararlo aca y registrarlo;
 * engine.ts no se toca. Eso es lo que va a permitir que las etapas siguientes
 * (ventas, agendamiento, contenido) sumen los suyos sin abrir el core.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { FlowNode, FlowExecutionContext, IncomingMessage } from "../types";

// ------------------------------------------------------------
// Nodos
// ------------------------------------------------------------

/**
 * Lo que un nodo le devuelve al motor:
 *   - "pause"          -> cortar el recorrido aca (delay, espera, derivacion)
 *   - "handle:<nombre>" -> seguir por esa salida (condiciones, A/B split)
 *   - void             -> seguir por la unica salida
 */
export type NodeResult = string | void;

/**
 * Capacidades del motor que un nodo puede necesitar.
 *
 * Existe para cortar la dependencia circular: el nodo Go To Flow necesita
 * arrancar otro flow, pero si lo importara de engine.ts, engine.ts importaria
 * el registro y el registro al nodo. Se lo pasamos por parametro y listo.
 */
export interface FlowRuntime {
  executeFlow(
    supabase: SupabaseClient<Database>,
    context: FlowExecutionContext
  ): Promise<void>;
}

export interface NodeExecutionArgs<TData = unknown> {
  supabase: SupabaseClient<Database>;
  /** El nodo completo, por si hace falta el id o algo del canvas. */
  node: FlowNode;
  /** node.data ya tipado por la definicion. */
  data: TData;
  context: FlowExecutionContext;
  sessionId: string;
  runtime: FlowRuntime;
}

/**
 * Como llega un nodo desde el canvas cuando su `type` guardado no es el tipo
 * canonico.
 *
 * El panel de nodos guarda los once nodos de accion como `type: "action"` con
 * el tipo real adentro de `data.actionType`. El motor no entendia eso y los
 * descartaba en silencio: Add Tag, Set Field, Human Takeover y compania pasaban
 * el panel de Test y despues no hacian nada en produccion. En vez de migrar los
 * flows guardados, cada nodo declara aca como se lo reconoce.
 */
export interface NodeAlias {
  /** El `type` con el que el canvas guarda el nodo. */
  nodeType: string;
  /** Valor de `data.actionType` que corresponde a este nodo, si aplica. */
  actionType?: string;
}

export interface NodeDefinition<TData = never> {
  /** Tipo canonico. Es el que usan el historial de analytics y los tests. */
  type: string;
  /** Etiqueta corta para la UI y los logs. */
  label: string;
  /** Formas alternativas en que el canvas puede guardar este nodo. */
  aliases?: NodeAlias[];
  /**
   * Si el nodo escribe en context.variables, el motor guarda las variables en
   * la sesion despues de ejecutarlo, para que sobrevivan a una pausa. Antes
   * esto era un `if` con dos tipos escritos a mano adentro del motor.
   */
  persistsVariables?: boolean;
  execute(args: NodeExecutionArgs<TData>): Promise<NodeResult> | NodeResult;
}

// ------------------------------------------------------------
// Triggers
// ------------------------------------------------------------

/**
 * Cuando se evalua un trigger. Separa los que miran un mensaje entrante de los
 * que nacen de un evento del CRM o de una corrida del cron.
 */
export type TriggerScope = "message" | "comment" | "event" | "scheduled";

export interface TriggerMatchArgs {
  /** La fila de `triggers`. */
  trigger: TriggerRow;
  /** Config del trigger, ya parseada desde la columna jsonb. */
  config: Record<string, unknown>;
  message: IncomingMessage;
  /** Texto del mensaje en minusculas y sin espacios en los bordes. */
  text: string;
  isFirstMessage: boolean;
}

export interface TriggerRow {
  id: string;
  flow_id: string;
  channel_id: string | null;
  type: string;
  config: unknown;
  priority: number;
  is_active: boolean;
}

export interface TriggerGuardArgs {
  supabase: SupabaseClient<Database>;
  trigger: TriggerRow;
  workspaceId: string;
  contactId: string;
  conversationId: string;
}

export interface TriggerDefinition {
  type: string;
  label: string;
  scope: TriggerScope;
  /**
   * Orden de resolucion entre tipos, de mayor a menor. Antes era una cascada de
   * `if` adentro del matcher: un boton siempre le gana a una palabra clave, y
   * el trigger por defecto es el ultimo recurso. Ahora es un numero, asi que un
   * tipo nuevo elige su lugar sin reescribir la cascada.
   */
  priority: number;
  /** Decide si este trigger le corresponde al mensaje. Solo para scope "message"/"comment". */
  matches?(args: TriggerMatchArgs): boolean;
  /**
   * Puerta de entrada extra, evaluada despues del match y antes de disparar.
   *
   * Todavia no la usa nadie. Esta puesta para lo que viene en la Fase 3: la
   * convivencia del agente de IA con las automatizaciones necesita condiciones
   * de arranque del tipo "ejecutar solo si el agente esta apagado en esta
   * conversacion", que se apoyan en conversations.is_automation_paused. Cuando
   * llegue, es completar este campo en la definicion, no tocar el motor.
   */
  guard?(args: TriggerGuardArgs): Promise<boolean>;
}

// ------------------------------------------------------------
// Condiciones
// ------------------------------------------------------------

/** Un operador del nodo Condition (equals, contains, gt...). */
export interface ConditionOperator {
  operator: string;
  label: string;
  evaluate(actual: string | undefined, expected: string): boolean;
}

export interface ConditionFieldArgs {
  supabase: SupabaseClient<Database>;
  /** Lo que viene despues del prefijo. En "tag:interesado" es "interesado". */
  argument: string;
  context: FlowExecutionContext;
  /** El contacto ya cargado, para no volver a consultarlo por cada condicion. */
  contact: Record<string, unknown>;
}

/**
 * De donde sale el valor a comparar.
 *
 * Los campos con prefijo (`tag:`, `variable:`) se resuelven aca. Es el lugar
 * donde el Bloque 2 va a enchufar "¿el contacto esta en la secuencia X?" (F14)
 * como un registro mas, sin tocar el nodo Condition.
 */
export interface ConditionField {
  /** Prefijo con dos puntos ("tag:") o nombre exacto ("platform"). */
  prefix: string;
  label: string;
  resolve(
    args: ConditionFieldArgs
  ): Promise<string | undefined> | string | undefined;
}
