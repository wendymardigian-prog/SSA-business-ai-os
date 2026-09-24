import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import { assignConversation } from "./effects";
import type { AgentConfig } from "../config";

/**
 * asignar_conversacion: conversations.assigned_to.
 *
 * Solo a los usuarios habilitados, con un criterio: round-robin entre ellos,
 * un usuario fijo, o el setter del contacto. El servidor verifica que el
 * elegido siga siendo miembro del workspace.
 */

const inputSchema = z.object({
  motivo: z.string().min(3).max(200).describe("Por que conviene que una persona tome esta conversacion."),
});

const configSchema = z
  .object({
    allowedUserIds: z.array(z.string().uuid()).max(50).default([]),
    strategy: z.enum(["round_robin", "fixed", "contact_setter"]).default("round_robin"),
    fixedUserId: z.string().uuid().nullable().default(null),
  })
  .refine((v) => v.strategy !== "fixed" || (v.fixedUserId !== null && v.allowedUserIds.includes(v.fixedUserId)), {
    message: "Con usuario fijo, ese usuario tiene que estar entre los habilitados.",
    path: ["fixedUserId"],
  });

type Config = z.infer<typeof configSchema>;

function configOf(agent: AgentConfig): Config {
  const parsed = configSchema.safeParse(agent.toolsConfig["asignar_conversacion"] ?? {});
  return parsed.success ? parsed.data : configSchema.parse({});
}

export const assignConversationTool: AgentToolDefinition<z.infer<typeof inputSchema>, Config> = {
  name: "asignar_conversacion",
  label: "Asignar conversacion",
  description:
    "Asigna la conversacion a una persona del equipo para que la siga (sin derivar: vos segui respondiendo salvo que tambien derives). El sistema elige a quien segun la configuracion. No le avises al lead.",
  inputSchema,
  configSchema,
  configFields: [
    {
      key: "allowedUserIds",
      label: "A quien puede asignar",
      kind: "multiselect",
      optionSource: "members",
      requiredForTool: true,
      emptySourceMessage: "No hay miembros en el workspace para asignar.",
    },
    {
      key: "strategy",
      label: "Criterio",
      kind: "select",
      options: [
        { value: "round_robin", label: "Rotar entre los habilitados (round-robin)" },
        { value: "fixed", label: "Siempre al mismo usuario" },
        { value: "contact_setter", label: "Al setter del contacto" },
      ],
    },
    { key: "fixedUserId", label: "Usuario fijo", kind: "select", optionSource: "members", showIf: { key: "strategy", equals: "fixed" } },
  ],
  isAvailable: (agent) => {
    const c = configOf(agent);
    return c.strategy === "contact_setter" || c.allowedUserIds.length > 0;
  },
  auditAction: "assign",
  async execute({ input, config, ctx }) {
    const result = await assignConversation(
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
      { reason: input.motivo },
    );
    return { ok: result.ok, forModel: result.message, detail: result.detail, auditLogId: result.auditLogId ?? null };
  },
};
