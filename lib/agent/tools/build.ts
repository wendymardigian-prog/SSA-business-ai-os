import { tool, type ToolSet } from "ai";
import type { AgentToolContext, AgentToolDefinition } from "./types";
import type { AppliedAction, SuggestedAction } from "../drafts/types";
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
  /**
   * turnEnded/escalated: una herramienta termino el turno (derivar a una
   * persona, solo en envio directo). suggestions: lo que en modo borrador
   * quedo como sugerencia en vez de ejecutarse. applied: lo que el turno ya
   * aplico en el CRM, para mostrarlo en el borrador.
   */
  state: { turnEnded: boolean; escalated: boolean; suggestions: SuggestedAction[]; applied: AppliedAction[] };
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
  const state: BuiltToolSet["state"] = { turnEnded: false, escalated: false, suggestions: [], applied: [] };
  const draft = ctx.mode === "draft";
  const tools: ToolSet = {};

  for (const definition of toolsForAgent(ctx.agent)) {
    // Solo lectura: nada que escriba en el CRM. Las diferidas en borrador se
    // quedan: solo dejan una sugerencia.
    if (ctx.readOnly && definition.auditAction && !(draft && definition.deferInDraft)) {
      await ctx.run.step({
        kind: "tool_call",
        name: definition.name,
        error: "herramienta omitida: esta version no puede modificar el CRM",
      });
      continue;
    }
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
      description: draft && definition.descriptionInDraft ? definition.descriptionInDraft : definition.description,
      inputSchema: definition.inputSchema,
      execute: async (input: unknown) => {
        const startedAt = Date.now();
        // Despues de derivar, ninguna herramienta mas: el turno termino.
        if (state.turnEnded) {
          return "El turno ya termino. No hagas nada mas.";
        }
        try {
          // Modo borrador: derivar y pausarse no se ejecutan. Quedan como
          // sugerencia y se aplican si la persona aprueba el borrador.
          if (draft && definition.deferInDraft) {
            const deferred = definition.deferInDraft({ input, config: resolved.config, ctx });
            state.suggestions.push(deferred.suggestion);
            await ctx.run.step({
              kind: "tool_call",
              name: definition.name,
              input,
              output: { diferida: true, sugerencia: deferred.suggestion, ...(deferred.detail ? { detalle: deferred.detail } : {}) },
              durationMs: Date.now() - startedAt,
            });
            return deferred.forModel;
          }
          const result = await definition.execute({ input, config: resolved.config, ctx });
          if (result.ok && result.auditLogId) {
            state.applied.push({ tool: definition.name, label: definition.label, detail: result.detail ?? null, auditLogId: result.auditLogId });
          }
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
