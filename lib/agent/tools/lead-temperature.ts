import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import { setTemperature } from "./effects";

/**
 * cambiar_temperatura: frio / tibio / caliente en contacts.lead_temperature.
 *
 * Por defecto solo puede SUBIRLA: bajar la temperatura de un lead es una
 * decision comercial que conviene que tome una persona. Se habilita desde la
 * pantalla si se quiere.
 */

const inputSchema = z.object({
  temperatura: z.enum(["cold", "warm", "hot"]).describe("cold = frio, warm = tibio, hot = caliente (listo para comprar)."),
  motivo: z.string().min(3).max(200).describe("Que dijo el lead que justifica el cambio."),
});

const configSchema = z.object({
  canLower: z.boolean().default(false),
});

export const leadTemperatureTool: AgentToolDefinition<z.infer<typeof inputSchema>, z.infer<typeof configSchema>> = {
  name: "cambiar_temperatura",
  label: "Cambiar temperatura del lead",
  description:
    "Cambia la temperatura del lead segun el interes que muestra: cold (frio), warm (tibio), hot (caliente, listo para avanzar). Usala cuando la conversacion lo justifique. No le avises al lead.",
  inputSchema,
  configSchema,
  configFields: [{ key: "canLower", label: "Puede bajar la temperatura", hint: "Apagado: solo la sube.", kind: "boolean" }],
  auditAction: "temperature",
  async execute({ input, config, ctx }) {
    const result = await setTemperature(
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
      { temperature: input.temperatura, reason: input.motivo },
    );
    return { ok: result.ok, forModel: result.message, auditLogId: result.auditLogId ?? null };
  },
};
