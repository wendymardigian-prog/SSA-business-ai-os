import { tool, type ToolSet } from "ai";
import type { AgentToolContext, AgentToolDefinition } from "./types";
import { toolsForAgent } from "./index";

/**
 * Arma la caja de herramientas de un turno para el AI SDK.
 *
 * Tres garantias que viven aca y no en cada herramienta:
 *
 *   - La configuracion se valida contra el configSchema de la herramienta. Si
 *     tools_config esta roto, la herramienta NO se ofrece (y queda el paso con
 *     el motivo): nunca corre con parametros que el operador no fijo. Las
 *     obligatorias, con config rota, corren con sus defaults: la salida de
 *     emergencia no se puede perder por un jsonb mal escrito.
 *   - Cada ejecucion deja su paso en el run, lo escriba o no la herramienta.
 *   - Una herramienta que lanza no tumba el turno: el modelo recibe un error
 *     corto y el paso queda con el error.
 */

export interface BuiltToolSet {
  tools: ToolSet;
  /** Se prende cuando una herramienta termino el turno (derivar a una persona). */
  state: { turnEnded: boolean; escalated: boolean };
}

function resolveConfig(
  definition: AgentToolDefinition<unknown, unknown>,
  raw: unknown,
): { ok: true; config: unknown } | { ok: false; problem: string } {
  const parsed = definition.configSchema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, config: parsed.data };
  if (definition.required) {
    return { ok: true, config: definition.configSchema.parse({}) };
  }
  return { ok: false, problem: parsed.error.issues[0]?.message ?? "config invalida" };
}

export async function buildToolSet(ctx: AgentToolContext): Promise<BuiltToolSet> {
  const state = { turnEnded: false, escalated: false };
  const tools: ToolSet = {};

  for (const definition of toolsForAgent(ctx.agent)) {
    const resolved = resolveConfig(definition, ctx.agent.toolsConfig[definition.name]);
    if (!resolved.ok) {
      await ctx.run.step({
        kind: "tool_call",
        name: definition.name,
        error: `herramienta omitida: configuracion invalida (${resolved.problem})`,
      });
      continue;
    }

    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: async (input: unknown) => {
        const startedAt = Date.now();
        // Despues de derivar, ninguna herramienta mas: el turno termino.
        if (state.turnEnded) {
          return "El turno ya termino. No hagas nada mas.";
        }
        try {
          const result = await definition.execute({ input, config: resolved.config, ctx });
          if (result.endsTurn) {
            state.turnEnded = true;
            if (definition.auditAction === "human_takeover") state.escalated = true;
          }
          if (!result.stepAlreadyRecorded) {
            await ctx.run.step({
              kind: "tool_call",
              name: definition.name,
              input,
              output: result.detail ?? { ok: result.ok },
              auditLogId: result.auditLogId ?? null,
              kbChunkIds: result.kbChunkIds ?? null,
              durationMs: Date.now() - startedAt,
              error: result.ok ? null : "la herramienta no pudo completar la accion",
            });
          }
          return result.forModel;
        } catch (err) {
          const message = err instanceof Error ? err.message : "error desconocido";
          console.error(`[agent-tool] ${definition.name} fallo:`, message);
          await ctx.run.step({
            kind: "tool_call",
            name: definition.name,
            input,
            durationMs: Date.now() - startedAt,
            error: message,
          });
          return "La herramienta fallo. Si no podes resolverlo, deriva a una persona.";
        }
      },
    });
  }

  return { tools, state };
}
