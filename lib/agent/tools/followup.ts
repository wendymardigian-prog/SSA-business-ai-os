import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import { setFollowup } from "./effects";

/**
 * programar_seguimiento: contacts.next_followup_date.
 *
 * Dos limites: un maximo de dias hacia adelante, y si puede pisar una fecha
 * que puso una persona (por defecto no: si alguien decidio "lo llamo el
 * martes", el agente no la mueve).
 */

const inputSchema = z
  .object({
    dias: z.number().int().min(0).max(3650).optional().describe("En cuantos dias volver a contactar al lead."),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("O una fecha concreta, AAAA-MM-DD."),
    motivo: z.string().min(3).max(200).describe("Que quedo pendiente o que pidio el lead."),
  })
  .refine((v) => v.dias !== undefined || v.fecha !== undefined, { message: "Indica dias o fecha." });

const configSchema = z.object({
  maxDaysAhead: z.number().int().min(1).max(365).default(90),
  canOverrideManual: z.boolean().default(false),
});

export const followupTool: AgentToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof configSchema>> = {
  name: "programar_seguimiento",
  label: "Proximo seguimiento",
  description:
    "Programa cuando volver a contactar al lead (por ejemplo, si pide que le escriban la semana que viene). Indica en cuantos dias o en que fecha, y por que. No le avises al lead que lo anotaste.",
  inputSchema,
  configSchema,
  configFields: [
    { key: "maxDaysAhead", label: "Maximo de dias hacia adelante", kind: "number", min: 1, max: 365 },
    {
      key: "canOverrideManual",
      label: "Puede pisar una fecha puesta por una persona",
      hint: "Apagado: si alguien del equipo fijo el seguimiento, el agente no lo mueve.",
      kind: "boolean",
    },
  ],
  auditAction: "followup",
  async execute({ input, config, ctx }) {
    const result = await setFollowup(
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
      { days: input.dias ?? null, date: input.fecha ?? null, reason: input.motivo },
    );
    return { ok: result.ok, forModel: result.message, auditLogId: result.auditLogId ?? null };
  },
};
