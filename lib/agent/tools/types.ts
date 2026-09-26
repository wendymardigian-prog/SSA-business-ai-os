import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { AuditAction, Database } from "@/lib/types/database";
import type { AiRunHandle } from "@/lib/ai/run";
import type { AgentConfig } from "../config";
import type { SuggestedAction } from "../drafts/types";

/**
 * Contrato de una herramienta del agente (tool registry).
 *
 * Una herramienta no es un interruptor: es un interruptor MAS su configuracion.
 * Cada entrada declara el schema de su entrada (lo que el modelo le pasa) y el
 * schema de su configuracion (lo que el operador le fija en la pantalla). Con
 * eso la pantalla de Agentes puede renderizar los parametros de cualquier
 * herramienta sin codigo nuevo, y el servidor valida tools_config contra el
 * mismo schema.
 *
 * Sumar una herramienta (Bloque 2b: etiquetar, temperatura, seguimiento,
 * asignar, buscar en el CRM) es agregar un archivo y una linea en index.ts. El
 * loop y la pantalla no se tocan.
 */

export interface AgentToolContext {
  supabase: SupabaseClient<Database>;
  agent: AgentConfig;
  workspaceId: string;
  conversationId: string | null;
  contactId: string | null;
  channelId: string | null;
  run: AiRunHandle;
  /** Codigo del turno para delimitar contenido no confiable (lib/agent/untrusted.ts). */
  nonce: string;
  /**
   * Como entrega el turno (Bloque 2c). En "draft" las herramientas que cambian
   * el control de la conversacion no se ejecutan: quedan como sugerencia en el
   * borrador. Default "send".
   */
  mode?: "send" | "draft";
  /**
   * Solo lectura (Bloque 2d-A): las herramientas que escriben en el CRM no se
   * ofrecen. Lo usa la regeneracion de un borrador sin mensajes nuevos del
   * lead: con asignacion en round-robin, regenerar tres veces paseaba la
   * conversacion por tres personas. Las que en borrador quedan como
   * sugerencia (derivar, pausarse) si se ofrecen: no ejecutan nada.
   */
  readOnly?: boolean;
}

export interface AgentToolResult {
  /** Si la herramienta hizo lo que se le pidio. */
  ok: boolean;
  /**
   * Lo que vuelve al modelo. Corto, en lenguaje llano, sin datos de mas: el
   * modelo lo lee como resultado, y un resultado de herramienta tambien es
   * contenido no confiable si trae texto de la base.
   */
  forModel: string;
  /** Lo que queda en el paso del run (detalle tecnico, resumido). */
  detail?: unknown;
  /** Entrada del audit_log con el efecto de negocio, si hubo efecto. */
  auditLogId?: string | null;
  /** Ids de fragmentos de la KB usados, para el paso del run. */
  kbChunkIds?: string[];
  /** La herramienta ya escribio su propio paso (la busqueda en la KB lo hace). */
  stepAlreadyRecorded?: boolean;
  /**
   * Si despues de esta herramienta el turno termina sin responder al lead.
   * Derivar a una persona corta el turno: el agente ya no tiene que contestar.
   */
  endsTurn?: boolean;
}

/**
 * De donde salen las opciones de un campo de configuracion que depende de la
 * base. La pagina las carga una vez y las pasa por nombre: la pestana no sabe
 * que herramienta pide "tags", solo que hay una fuente que se llama asi.
 */
export type ToolOptionSource = "tags" | "members" | "contact_fields";

export interface ToolConfigOption {
  value: string;
  label: string;
  /** Ayuda corta al lado de la opcion (ej. "sensible"). */
  hint?: string;
}

/**
 * Como se muestra cada parametro de una herramienta. Es la parte "de pantalla"
 * del configSchema: el zod valida en el servidor, esto dice que control usar.
 * La pestana Herramientas renderiza cualquier herramienta leyendo esto, sin
 * condicionales por nombre.
 */
export type ToolConfigField = {
  key: string;
  label: string;
  hint?: string;
  /** Mostrar solo cuando otro campo tiene este valor (ej. usuario fijo). */
  showIf?: { key: string; equals: unknown };
} & (
  | { kind: "boolean" }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "select"; options?: ToolConfigOption[]; optionSource?: ToolOptionSource }
  | {
      kind: "multiselect";
      options?: ToolConfigOption[];
      optionSource?: ToolOptionSource;
      /**
       * Sin opciones en la fuente, la herramienta no se puede habilitar y la
       * pantalla muestra este mensaje en vez de un desplegable vacio.
       */
      requiredForTool?: boolean;
      emptySourceMessage?: string;
    }
);

export interface AgentToolDefinition<TInput = unknown, TConfig = unknown> {
  /** Nombre estable que ve el modelo. snake_case. */
  name: string;
  /** Nombre para la pantalla. */
  label: string;
  /** Lo que el modelo lee para decidir cuando usarla. */
  description: string;
  inputSchema: z.ZodType<TInput>;
  configSchema: z.ZodType<TConfig>;
  /** Como renderizar cada parametro del configSchema en la pestana Herramientas. */
  configFields: ToolConfigField[];
  /**
   * Si la herramienta existe para este agente. Una herramienta que no aplica
   * no se ofrece: no existe-y-devuelve-error, directamente no esta en la caja.
   */
  isAvailable?: (agent: AgentConfig) => boolean;
  /**
   * Siempre habilitada, no se puede apagar desde la pantalla. Solo para la
   * salida de emergencia (derivar a una persona).
   */
  required?: boolean;
  /** Captura la intención declarada en state.intent (F26). */
  capturesIntent?: boolean;
  /**
   * Si su encendido se decide en otra pestana (la busqueda en la KB se prende
   * desde Conocimiento). La pantalla de Herramientas la muestra, sin switch.
   */
  managedFrom?: "knowledge";
  auditAction?: AuditAction;
  execute(args: { input: TInput; config: TConfig; ctx: AgentToolContext }): Promise<AgentToolResult>;
  /**
   * Modo borrador (Bloque 2c): si la herramienta cambia el control de la
   * conversacion (derivar, pausarse), en vez de ejecutarse devuelve una
   * sugerencia que se aplica si la persona aprueba el borrador. Una
   * herramienta sin esto se ejecuta igual en los dos modos.
   */
  deferInDraft?(args: { input: TInput; config: TConfig; ctx: AgentToolContext }): {
    suggestion: SuggestedAction;
    forModel: string;
    detail?: unknown;
  };
  /** Descripcion para el modelo en modo borrador, si cambia (derivar ya no termina el turno). */
  descriptionInDraft?: string;
}
