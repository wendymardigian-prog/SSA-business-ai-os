import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import { setQualification } from "./effects";

/**
 * calificar_lead: el nivel de calificación del lead, del 1 al 5 (00329).
 *
 * El agente decide el nivel con la rúbrica del negocio (Ajustes → Estados), que le
 * llega en el contexto del contacto solo si tiene esta herramienta. Por defecto
 * solo puede SUBIRLO y no pisa un nivel que puso una persona o una automatización:
 * bajar a un lead es una decisión comercial.
 *
 * Nace apagada, como todas; la migración 00329 la prendió en los agentes que ya
 * usaban `cambiar_temperatura`.
 */

export const QUALIFY_TOOL_NAME = "calificar_lead";

const inputSchema = z.object({
  nivel: z.number().int().min(1).max(5).describe("El nivel de calificación, del 1 al 5, según los niveles del negocio."),
  motivo: z.string().min(3).max(200).describe("Qué dijo o hizo el lead que justifica ese nivel, en una frase."),
});

const configSchema = z.object({
  canLower: z.boolean().default(false),
  canOverrideHuman: z.boolean().default(false),
});

export const qualificationTool: AgentToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof configSchema>> = {
  name: QUALIFY_TOOL_NAME,
  label: "Calificar al lead (1 a 5)",
  description:
    "Pone el nivel de calificación del lead, del 1 al 5, según los niveles del negocio que tenés en el contexto del contacto. Usala cuando la conversación te dé información suficiente (necesidad, presupuesto, quién decide, urgencia). No le avises al lead.",
  inputSchema,
  configSchema,
  configFields: [
    { key: "canLower", label: "Puede bajar la calificación", hint: "Apagado: solo la sube.", kind: "boolean" },
    {
      key: "canOverrideHuman",
      label: "Puede pisar una calificación puesta por una persona",
      hint: "Apagado: si alguien del equipo o una automatización ya la puso, el agente no la cambia.",
      kind: "boolean",
    },
  ],
  auditAction: "qualification",
  async execute({ input, config, ctx }) {
    const result = await setQualification(
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
      { level: input.nivel, reason: input.motivo },
    );
    return { ok: result.ok, forModel: result.message, detail: result.detail, auditLogId: result.auditLogId ?? null };
  },
};
