import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { AuditAction, Database } from "@/lib/types/database";
import type { AiRunHandle } from "@/lib/ai/run";
import type { AgentConfig } from "../config";

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

export interface AgentToolDefinition<TInput = unknown, TConfig = unknown> {
  /** Nombre estable que ve el modelo. snake_case. */
  name: string;
  /** Nombre para la pantalla. */
  label: string;
  /** Lo que el modelo lee para decidir cuando usarla. */
  description: string;
  inputSchema: z.ZodType<TInput>;
  configSchema: z.ZodType<TConfig>;
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
  /**
   * Si su encendido se decide en otra pestana (la busqueda en la KB se prende
   * desde Conocimiento). La pantalla de Herramientas la muestra, sin switch.
   */
  managedFrom?: "knowledge";
  auditAction?: AuditAction;
  execute(args: { input: TInput; config: TConfig; ctx: AgentToolContext }): Promise<AgentToolResult>;
}
