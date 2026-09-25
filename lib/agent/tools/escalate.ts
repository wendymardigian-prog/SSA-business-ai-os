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
  descriptionInDraft:
    "Sugiere pasar la conversacion a una persona del equipo. En este canal tus respuestas las revisa una persona antes de salir: la sugerencia le llega a ella junto con tu borrador. Usala en los mismos casos (no sabes, no estas seguro, el lead pide una persona, el tema se sale de lo que podes resolver). Despues podes escribir una respuesta breve para el lead, o no responder nada.",
  deferInDraft({ input, config }) {
    return {
      suggestion: { type: "escalate", reason: input.motivo, summary: input.resumen, reopen: config.reopenConversation },
      forModel:
        "Anotado: la derivacion queda como sugerencia para la persona que revisa. Si tenes algo breve para decirle al lead mientras tanto, escribilo; si no, no respondas nada.",
      detail: { motivo: input.motivo },
    };
  },
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
