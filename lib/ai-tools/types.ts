import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { ProposalField } from "@/lib/ai-proposals/types";
import type { AiRunHandle } from "@/lib/ai/run";

/**
 * Capa de herramientas propia. Cada herramienta declara su nombre, sus parámetros, el permiso que exige y si
 * lee o escribe. La llaman el asistente del equipo y la bandeja de aprobación, siempre con la IDENTIDAD de la
 * persona: corre con su sesión, así la base (RLS) decide qué ve. El agente no tiene permisos propios: un prompt no es
 * una frontera de seguridad.
 */

// La sesión de la persona. Los esquemas propios (app_servicio) no están en los tipos generados.
export type SessionDb = SupabaseClient<any, any, any>;

export interface PersonToolContext {
  /** El cliente DE LA PERSONA (la RLS decide). Nunca el de servicio para leer. */
  supabase: SessionDb;
  /** El cliente de servicio: solo para lo que la propia herramienta ya comprobó con la sesión. */
  service: SessionDb;
  workspaceId: string;
  userId: string;
  actorName?: string;
  timeZone: string;
  /** Si la persona tiene un permiso (sale de su rol, en el servidor). */
  can: (key: string) => boolean;
  /** La corrida del asistente, para sumar lo que gasta una herramienta (el vector de una búsqueda). */
  run?: Pick<AiRunHandle, "addEmbeddingUsage">;
}

export type PersonToolResult =
  | { ok: true; data?: unknown; message: string; auditLogId?: string | null; entityId?: string | null }
  | { ok: false; code: "no_access" | "invalid" | "failed" | "disabled"; message: string };

export interface PersonToolDefinition<TInput = unknown> {
  /** snake_case, lo que ve el modelo. */
  key: string;
  label: string;
  description: string;
  access: "read" | "write";
  /** El permiso que exige, además de `assistant.use`. */
  permission: string;
  params: z.ZodType<TInput>;
  /** Cómo editar los parámetros en la bandeja de aprobación (solo las de escritura). */
  fields: ProposalField[];
  /** Una línea para la propuesta: «Crear la tarea «Llamar a Ana»». */
  summarize(input: TInput): string;
  run(ctx: PersonToolContext, input: TInput): Promise<PersonToolResult>;
}

/** Lo que se responde cuando la persona no puede ver algo: sin datos ni pistas. */
export const NO_ACCESS_MESSAGE = "No tenés acceso a eso.";
