import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import { setSetterStatus } from "./effects";
import type { AgentConfig } from "../config";

/**
 * cambiar_estado_setter: mueve el estado de SETTER del contacto (pipeline, 00245).
 *
 * El agente hace el primer contacto, así que puede mover el estado de setter;
 * el de vendedor nunca (lo mueve quien cierra). Solo a los estados de la LISTA
 * BLANCA configurada que sigan activos en Ajustes → Estados. Por defecto NO
 * pisa un estado que puso una persona del equipo.
 *
 * Nace apagada, como todas: se habilita en cada agente. Con la lista blanca
 * vacía la herramienta no existe para el modelo.
 */

const inputSchema = z.object({
  estado: z.string().min(1).max(80).describe("El nombre del estado, tal cual figura en la lista permitida."),
  motivo: z.string().min(3).max(200).describe("Qué dijo o hizo el lead que justifica el cambio, en una frase."),
});

const configSchema = z.object({
  allowedStatuses: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(30).default([]),
  canOverrideHuman: z.boolean().default(false),
});

type Config = z.infer<typeof configSchema>;

function configOf(agent: AgentConfig): Config {
  const parsed = configSchema.safeParse(agent.toolsConfig["cambiar_estado_setter"] ?? {});
  return parsed.success ? parsed.data : configSchema.parse({});
}

export const setterStatusTool: AgentToolDefinition<z.infer<typeof inputSchema>, Config> = {
  name: "cambiar_estado_setter",
  label: "Cambiar el estado de setter",
  description:
    "Cambia el estado de setter del contacto en el pipeline (por ejemplo: contactado, en conversación, calificado, no calificado) según cómo avanza la conversación. Solo podés usar los estados de la lista permitida; si usás uno que no está, la herramienta te devuelve los que sí podés. No le avises al lead.",
  inputSchema,
  configSchema,
  configFields: [
    {
      key: "allowedStatuses",
      label: "Estados que puede poner",
      hint: "Solo estados de setter activos (Ajustes → Estados). El de vendedor no lo toca nunca.",
      kind: "multiselect",
      optionSource: "setter_statuses",
      requiredForTool: true,
      emptySourceMessage: "Todavía no hay estados de setter activos. Crealos en Ajustes → Estados para poder habilitar esta herramienta.",
    },
    {
      key: "canOverrideHuman",
      label: "Puede pisar un estado que puso una persona",
      hint: "Apagado: si alguien del equipo ya puso el estado, el agente no lo cambia.",
      kind: "boolean",
    },
  ],
  isAvailable: (agent) => configOf(agent).allowedStatuses.length > 0,
  auditAction: "setter_status",
  async execute({ input, config, ctx }) {
    const result = await setSetterStatus(
      {
        supabase: ctx.supabase,
        workspaceId: ctx.workspaceId,
        agentId: ctx.agent.id,
        runId: ctx.run.runId,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        channelId: ctx.channelId,
        origin: "tool",
      },
      config,
      { status: input.estado, reason: input.motivo },
    );
    return { ok: result.ok, forModel: result.message, detail: result.detail, auditLogId: result.auditLogId ?? null };
  },
};
