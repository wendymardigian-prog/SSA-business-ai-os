import { z } from "zod";
import { escalateToHuman } from "../escalate";
import type { AgentToolDefinition } from "./types";

/**
 * derivar_a_humano: la salida de emergencia del agente.
 *
 * Obligatoria (no se puede apagar): es lo que el agente usa cuando no sabe,
 * cuando el lead pide una persona, o cuando algo se sale de lo que puede
 * resolver. Un agente sin esta herramienta solo tiene dos opciones cuando no
 * sabe: inventar o callarse.
 */

const inputSchema = z.object({
  motivo: z.string().min(3).max(200).describe("Por que se deriva, en una frase corta."),
  resumen: z
    .string()
    .min(3)
    .max(400)
    .describe("Resumen del contexto para la persona que toma la conversacion: que quiere el lead y que se hablo."),
});

const configSchema = z.object({
  /** Si ademas de derivar se reabre la conversacion (estado abierto). */
  reopenConversation: z.boolean().default(true),
});

export const escalateTool: AgentToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof configSchema>> = {
  name: "derivar_a_humano",
  label: "Derivar a una persona",
  description:
    "Pasa la conversacion a una persona del equipo y termina tu turno sin responder. Usala si no sabes la respuesta, si no estas seguro, si el lead pide hablar con una persona, o si el tema se sale de lo que podes resolver. Nunca inventes una respuesta: derivar es siempre mejor que inventar.",
  inputSchema,
  configSchema,
  configFields: [
    {
      key: "reopenConversation",
      label: "Reabrir la conversacion al derivar",
      hint: "Si estaba cerrada o pospuesta, vuelve a abiertas para que alguien la vea.",
      kind: "boolean",
    },
  ],
  required: true,
  auditAction: "human_takeover",
  async execute({ input, config, ctx }) {
    if (!ctx.conversationId) {
      return { ok: false, forModel: "No hay una conversacion para derivar." };
    }
    const { auditLogId } = await escalateToHuman(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      channelId: ctx.channelId,
      agentId: ctx.agent.id,
      runId: ctx.run.runId,
      reason: input.motivo,
      summary: input.resumen,
      origin: "tool",
      reopen: config.reopenConversation,
    });
    return {
      ok: true,
      forModel: "Listo: la conversacion quedo en manos de una persona. No respondas nada mas.",
      detail: { motivo: input.motivo },
      auditLogId,
      endsTurn: true,
    };
  },
};
