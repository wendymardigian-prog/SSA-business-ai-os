import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import { pauseAgentInConversation } from "./effects";

/**
 * pausarse: el agente deja de atender esta conversacion por un tiempo.
 *
 * Usa conversations.agent_paused_until (la misma palanca que los flows). Con
 * reanudacion automatica, al vencer vuelve solo; sin ella, queda en
 * 'infinity' hasta que una persona o un flow lo reanude. No termina el turno:
 * puede responder ("dale, te escribo la semana que viene") y quedar pausado
 * para lo que siga.
 */

const inputSchema = z.object({
  minutos: z.number().int().min(1).max(60 * 24 * 30).describe("Por cuanto tiempo dejar de responder, en minutos."),
  motivo: z.string().min(3).max(200).describe("Por que (ej.: el lead pidio que no le escriban hasta el lunes)."),
});

const configSchema = z.object({
  maxMinutes: z.number().int().min(1).max(60 * 24 * 30).default(60 * 24),
  autoResume: z.boolean().default(true),
});

export const pauseSelfTool: AgentToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof configSchema>> = {
  name: "pausarse",
  label: "Pausarse en la conversacion",
  description:
    "Deja de responder en esta conversacion por un tiempo, por ejemplo si el lead pide que no le escriban por unos dias. Podes responder antes de pausarte. El tiempo se recorta al maximo permitido.",
  inputSchema,
  configSchema,
  configFields: [
    { key: "maxMinutes", label: "Maximo de minutos de pausa", hint: "1440 = un dia.", kind: "number", min: 1, max: 43200 },
    {
      key: "autoResume",
      label: "Se reanuda solo al vencer",
      hint: "Apagado: queda pausado hasta que una persona o un flow lo reanude.",
      kind: "boolean",
    },
  ],
  auditAction: "agent_paused",
  async execute({ input, config, ctx }) {
    const result = await pauseAgentInConversation(
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
      { minutes: input.minutos, reason: input.motivo },
    );
    return { ok: result.ok, forModel: result.message, detail: result.detail, auditLogId: result.auditLogId ?? null };
  },
};
