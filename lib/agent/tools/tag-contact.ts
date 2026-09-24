import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import { applyTags } from "./effects";
import type { AgentConfig } from "../config";

/**
 * etiquetar_contacto: agrega (y, si se permite, quita) tags del contacto.
 *
 * Solo tags de la LISTA BLANCA configurada, que a su vez solo puede tener tags
 * que existen en `tags`. Nunca crea uno nuevo: sin esto, en dos semanas hay
 * cuarenta etiquetas inventadas. El modelo pide por nombre; el servidor
 * resuelve contra la lista y rechaza lo que no esta.
 *
 * Con la lista vacia (hoy `tags` no tiene filas) la herramienta no existe para
 * el modelo, y la pantalla lo explica en vez de mostrar un desplegable vacio.
 */

const inputSchema = z.object({
  agregar: z.array(z.string().min(1).max(60)).max(10).default([]).describe("Nombres de etiquetas a agregar, exactamente como figuran en la lista permitida."),
  quitar: z.array(z.string().min(1).max(60)).max(10).default([]).describe("Nombres de etiquetas a quitar (solo si tenes permitido quitar)."),
  motivo: z.string().min(3).max(200).describe("Por que, en una frase."),
});

const configSchema = z.object({
  allowedTagIds: z.array(z.string().uuid()).max(100).default([]),
  canRemove: z.boolean().default(false),
});

type Config = z.infer<typeof configSchema>;

function configOf(agent: AgentConfig): Config {
  const parsed = configSchema.safeParse(agent.toolsConfig["etiquetar_contacto"] ?? {});
  return parsed.success ? parsed.data : configSchema.parse({});
}

export const tagContactTool: AgentToolDefinition<z.infer<typeof inputSchema>, Config> = {
  name: "etiquetar_contacto",
  label: "Etiquetar contacto",
  description:
    "Agrega o quita etiquetas del contacto para clasificarlo (por ejemplo: interesado, pidio precio, ya es cliente). Solo podes usar las etiquetas de la lista permitida que te devuelve la herramienta; no inventes nombres. No le avises al lead.",
  inputSchema,
  configSchema,
  configFields: [
    {
      key: "allowedTagIds",
      label: "Etiquetas que puede usar",
      hint: "Solo de las que existen en Contactos. El agente nunca crea etiquetas nuevas.",
      kind: "multiselect",
      optionSource: "tags",
      requiredForTool: true,
      emptySourceMessage: "Todavia no hay etiquetas en el workspace. Crealas desde la ficha de un contacto para poder habilitar esta herramienta.",
    },
    { key: "canRemove", label: "Puede quitar etiquetas", hint: "Apagado: solo agrega.", kind: "boolean" },
  ],
  isAvailable: (agent) => configOf(agent).allowedTagIds.length > 0,
  auditAction: "tag",
  async execute({ input, config, ctx }) {
    const result = await applyTags(
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
      { add: input.agregar, remove: input.quitar, reason: input.motivo },
    );
    return { ok: result.ok, forModel: result.message, detail: result.detail, auditLogId: result.auditLogId ?? null };
  },
};
