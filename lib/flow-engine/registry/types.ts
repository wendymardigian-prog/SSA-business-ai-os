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
import type { ContactFlowContext, FlowNode, FlowExecutionContext, IncomingMessage } from "../types";
import type { ConditionFieldSpec, FieldValue } from "../condition-eval";
import type { Requirement } from "../node-requirements";

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

/**
 * Lo que recibe un nodo. Por defecto, con contacto (`ContactFlowContext`): es lo que
 * reciben los nodos que lo necesitan, y el motor nunca los corre sin uno. Los que
 * sirven también sin contacto declaran `NodeExecutionArgs<Data, FlowExecutionContext>`.
 */
export interface NodeExecutionArgs<TData = unknown, TContext extends FlowExecutionContext = ContactFlowContext> {
  supabase: SupabaseClient<Database>;
  /** El nodo completo, por si hace falta el id o algo del canvas. */
  node: FlowNode;
  /** node.data ya tipado por la definicion. */
  data: TData;
  context: TContext;
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

interface NodeDefinitionBase<TData> {
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
  /**
   * Lo que este nodo le deja a los pasos siguientes para comparar (una
   * variable que guarda, por ejemplo). Puro y sin base: lo importa el catalogo
   * de condiciones, que corre en el navegador. La fuente es `node-outputs.ts`.
   */
  outputs?(data: TData): ConditionFieldSpec[];
  /**
   * Que conexion necesita este nodo para poder ejecutarse (G1): Resend, un numero de
   * WhatsApp, una IA... El editor lo muestra bloqueado si falta y el servidor no deja
   * PUBLICAR un flujo con un paso bloqueado. Sin esto, el nodo siempre puede correr.
   * La copia del navegador es `node-requirements.ts` (`NODE_REQUIREMENTS`):
   * `registry/consistency.test.ts` exige que digan lo mismo.
   */
  requires?: readonly Requirement[];
}

/**
 * Cada nodo declara si necesita un contacto (E15). Los que sí (mandar un mensaje, tags,
 * campos, secuencias, agenda, ventas...) reciben el contacto como texto; en un flujo sin
 * contacto el motor los saltea y lo anota. Los que no (Condiciones, Esperar, Enviar
 * email, HTTP, Ir a otro flujo, Avisar en la campana) reciben `contactId: string | null`.
 * `registry/consistency.test.ts` exige que todos lo declaren.
 */
export type NodeDefinition<TData = never> =
  | (NodeDefinitionBase<TData> & {
      needsContact: true;
      execute(args: NodeExecutionArgs<TData, ContactFlowContext>): Promise<NodeResult> | NodeResult;
    })
  | (NodeDefinitionBase<TData> & {
      needsContact: false;
      execute(args: NodeExecutionArgs<TData, FlowExecutionContext>): Promise<NodeResult> | NodeResult;
    });

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

/** Un evento de la cola de `automation_events`, ya leído. */
export interface AutomationEventRow {
  id: string;
  workspace_id: string;
  event_type: string;
  /** Null solo en los eventos de una persona del equipo (`eod_submitted`, 00182). */
  contact_id: string | null;
  /** La persona del equipo del evento (`eod_submitted`). */
  member_user_id?: string | null;
  payload: Record<string, unknown>;
}

/**
 * Sobre quién es un flujo. `contact` (todos los de siempre): un lead. `member`: una
 * persona del equipo, sin contacto (E15). `webhook`: un envío de un webhook entrante: arranca
 * sin contacto ni persona y el contacto aparece a mitad de flujo, cuando el paso "Crear o
 * actualizar contacto" lo crea o lo encuentra (Extra L). Lo declara el disparador; por
 * defecto `contact`.
 */
export type TriggerSubject = "contact" | "member" | "webhook" | "system";

/**
 * Qué disparó una sesión de flujo o un evento de automatización (Tirón 2, D1): se guarda en
 * `flow_sessions.source_type` y `automation_events.source_type` (00218), junto con `source_id`.
 * Es lo que permite que un flujo arranque SIN contacto: la restricción de la base exige contacto
 * u origen. Lo declara cada disparador (`TriggerDefinition.sourceType`); el valor de una sesión que
 * no lo pidió explícito lo completa la base según el contacto, la persona o el envío que tenga.
 */
export type AutomationSourceType = "contact" | "member" | "webhook" | "task" | "form" | "booking" | "sale" | "call" | "system";

/** Los orígenes que admite la base (el CHECK de 00218). Una sola lista: la usan el motor, los tests y los scripts. */
export const AUTOMATION_SOURCE_TYPES: readonly AutomationSourceType[] = ["contact", "member", "webhook", "task", "form", "booking", "sale", "call", "system"];

/** De dónde viene la ejecución de un flujo. `id` es la entidad que lo disparó (envío, evento, persona…). */
export interface AutomationSource {
  type: AutomationSourceType;
  id: string | null;
}

export interface TriggerEventArgs {
  supabase: SupabaseClient<Database>;
  event: AutomationEventRow;
  config: Record<string, unknown>;
  trigger: TriggerRow;
  /**
   * La agenda del evento, ya leída, cuando el payload trae `booking_id`.
   *
   * La carga el cron UNA vez por evento y se la pasa a todos los triggers: si
   * cada uno la consultara, un evento con diez flujos haría diez consultas
   * iguales.
   */
  booking?: Record<string, unknown> | null;
}

/** Lo que un trigger necesita para decir que variables aporta. */
export interface VariableSchemaContext {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
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
  /** Sobre quién es el flujo que arranca. Sin declarar = `contact` (todos los existentes). */
  subject?: TriggerSubject;
  /**
   * El origen que queda en la sesión que arranca este disparador (`flow_sessions.source_type`). Obligatorio para
   * todos: `registry/consistency.test.ts` falla si un disparador no lo declara. Un disparador de mensajes es
   * `contact`; uno de agenda, `booking`; un envío de webhook, `webhook`; una tarea, `task`; etc.
   */
  sourceType?: AutomationSourceType;
  /**
   * El disparador atiende tambien eventos SIN contacto (Tareas, F25): si el evento trae `contact_id` sigue el camino de
   * siempre; si no, trae `member_user_id` y el flujo corre sin contacto, sobre esa persona del equipo. A diferencia de
   * `subject: "member"`, el evento CON contacto no cambia en nada.
   */
  contactOptional?: boolean;
  /**
   * Solo `subject: "member"`: sobre qué entidad queda el disparo en el historial
   * (un flujo sin contacto no se audita sobre un contacto).
   */
  auditEntityFor?(args: TriggerEventArgs): { entityType: "eod_report"; entityId: string; metadata?: Record<string, unknown> } | null;
  /** Decide si este trigger le corresponde al mensaje. Solo para scope "message"/"comment". */
  matches?(args: TriggerMatchArgs): boolean;
  /**
   * Qué tipos de evento de `automation_events` puede atender este trigger.
   *
   * Antes el cron mapeaba a mano: `contact_created` a `new_contact` y todo lo
   * demás a `crm_event`. Con esto, sumar un tipo es declararlo acá y el cron
   * no se toca. `["*"]` = cualquier evento (es lo que hace `crm_event`).
   */
  eventTypes?: string[];
  /** Filtro propio del tipo sobre el evento. Sin él, con el tipo alcanza. */
  eventMatches?(args: TriggerEventArgs): boolean | Promise<boolean>;
  /**
   * La clave de idempotencia del disparo. Por defecto es `event:<id del
   * evento>`: una vez por evento. `new_contact` usa el contacto (una vez en
   * la vida) y los de agenda usan la agenda.
   */
  dedupeKeyFor?(args: TriggerEventArgs): string;
  /** Variables que este trigger le suma al contexto del flow. */
  variablesFor?(args: TriggerEventArgs): Promise<Record<string, unknown>> | Record<string, unknown>;
  /**
   * Que campos aporta este trigger para armar condiciones, con su tipo
   * (las preguntas de un formulario, los datos de una reunion...). Depende de
   * la config del trigger (a que formularios aplica), asi que va a la base:
   * corre en el SERVIDOR y el canvas lo pide con una accion del servidor.
   */
  variableSchema?(config: Record<string, unknown>, ctx: VariableSchemaContext): Promise<ConditionFieldSpec[]> | ConditionFieldSpec[];
  /**
   * Puerta de entrada extra de ESTE tipo, evaluada despues del match y antes
   * de disparar. Las puertas que valen para cualquier tipo y se prenden desde
   * la config del trigger son TriggerGuardDefinition (abajo).
   */
  guard?(args: TriggerGuardArgs): Promise<boolean>;
}

/**
 * Una puerta de arranque que se aplica a cualquier trigger y se prende desde su
 * config (Fase 3). La primera es "solo si el agente de IA esta apagado": con
 * eso, un flow con trigger por defecto deja de capturar los mensajes de las
 * conversaciones que atiende el agente.
 *
 * Se evalua despues del match, tambien para el trigger por defecto (que no
 * tiene matches y antes se devolvia sin pasar por ninguna puerta).
 */
export interface TriggerGuardDefinition {
  /** Clave booleana en trigger.config que la prende. */
  configKey: string;
  label: string;
  description: string;
  /** true = el trigger puede disparar. */
  allows(args: TriggerGuardArgs): Promise<boolean>;
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
  /**
   * Memoria de UNA corrida de nodo: lo que varios campos necesitan y es caro
   * (la respuesta del formulario) se carga una sola vez. La pasa el nodo
   * `branch`; el `condition` viejo no la usa.
   */
  memo?: Map<string, Promise<unknown>>;
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
  /**
   * El valor con su tipo real (una lista de tags, un numero) en vez de texto.
   * Solo lo usa el nodo `branch`; el `condition` viejo sigue con `resolve`.
   * Puede lanzar `MissingFieldError` (el campo ya no existe).
   */
  resolveTyped?(args: ConditionFieldArgs): Promise<FieldValue> | FieldValue;
}
