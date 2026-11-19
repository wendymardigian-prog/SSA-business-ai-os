import { tool, type ToolSet } from "ai";
import { createProposal } from "@/lib/ai-proposals/create";
import { DEFAULT_ASSISTANT_TOOL_KEYS, PERSON_TOOLS, getPersonTool } from "./registry";
import { NO_ACCESS_MESSAGE, type PersonToolContext, type PersonToolDefinition, type PersonToolResult } from "./types";

/**
 * Cómo se usa la capa de herramientas. Todo pasa por aquí: la interfaz, el asistente y la
 * aprobación de una propuesta.
 *
 *  - Sin `assistant.use`, nada (se comprueba en el SERVIDOR aunque la pantalla no lo ofrezca).
 *  - Solo las herramientas habilitadas para el asistente y cuyo permiso tiene la persona.
 *  - Las lecturas corren al momento con su sesión. Las escrituras pedidas por la IA NO se ejecutan: dejan una
 *    propuesta para que la persona la apruebe. Una escritura que aprueba una persona corre con SU sesión.
 */

export const IA_USE_PERMISSION = "assistant.use";

/** Las herramientas que el modelo puede ver para esta persona. Pura. */
export function toolsForPerson(
  can: (key: string) => boolean,
  enabledKeys: readonly string[] = DEFAULT_ASSISTANT_TOOL_KEYS,
): PersonToolDefinition<unknown>[] {
  if (!can(IA_USE_PERMISSION)) return [];
  const enabled = new Set(enabledKeys);
  return (PERSON_TOOLS as unknown as PersonToolDefinition<unknown>[]).filter((t) => enabled.has(t.key) && can(t.permission));
}

export type RunPersonToolResult = PersonToolResult | { ok: true; proposed: true; proposalId: string; message: string };

export interface RunPersonToolOptions {
  /** La pidió la IA (el asistente): una escritura queda propuesta. */
  byAi: boolean;
  agentId?: string | null;
  runId?: string | null;
  enabledKeys?: readonly string[];
  /** Ya la aprobó una persona (la ejecuta el núcleo de propuestas). */
  approved?: boolean;
}

export async function runPersonTool(ctx: PersonToolContext, key: string, rawInput: unknown, opts: RunPersonToolOptions): Promise<RunPersonToolResult> {
  if (!ctx.can(IA_USE_PERMISSION)) return { ok: false, code: "no_access", message: "Tu rol no tiene el permiso «Usar el asistente»." };
  const definition = getPersonTool(key);
  // Una herramienta que no existe o que no está habilitada no se distingue de una sin acceso.
  if (!definition) return { ok: false, code: "no_access", message: NO_ACCESS_MESSAGE };
  if (!opts.approved && !(opts.enabledKeys ?? DEFAULT_ASSISTANT_TOOL_KEYS).includes(key)) {
    return { ok: false, code: "disabled", message: NO_ACCESS_MESSAGE };
  }
  if (!ctx.can(definition.permission)) return { ok: false, code: "no_access", message: NO_ACCESS_MESSAGE };
  const parsed = definition.params.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Parámetros inválidos." };

  if (definition.access === "write" && opts.byAi && !opts.approved) {
    const proposal = await createProposal(ctx.service as never, {
      workspaceId: ctx.workspaceId,
      executor: "person_tool",
      agentId: opts.agentId ?? null,
      runId: opts.runId ?? null,
      requestedBy: ctx.userId,
      toolKey: definition.key,
      label: definition.summarize(parsed.data),
      params: parsed.data,
    });
    if (!proposal) return { ok: false, code: "failed", message: "No pude dejar la propuesta. No se hizo nada." };
    return { ok: true, proposed: true, proposalId: proposal.id, message: "Queda propuesto: se hará cuando la persona lo apruebe." };
  }

  try {
    return await definition.run(ctx, parsed.data);
  } catch (err) {
    console.error(`[ai-tools] ${key} falló:`, err instanceof Error ? err.message : String(err));
    return { ok: false, code: "failed", message: "No pude completarlo." };
  }
}

/**
 * Las herramientas para el AI SDK, ya filtradas para la persona. Las usa el asistente. El
 * resultado de una lectura vuelve al modelo como datos, nunca como instrucciones.
 */
export function asAiSdkTools(ctx: PersonToolContext, opts: { agentId: string | null; runId: string | null; enabledKeys?: readonly string[] }): ToolSet {
  const out: ToolSet = {};
  for (const definition of toolsForPerson(ctx.can, opts.enabledKeys)) {
    out[definition.key] = tool({
      description: definition.description,
      inputSchema: definition.params as never,
      execute: async (input: unknown) => {
        const result = await runPersonTool(ctx, definition.key, input, { byAi: true, agentId: opts.agentId, runId: opts.runId, enabledKeys: opts.enabledKeys });
        if (!result.ok) return { ok: false, mensaje: result.message };
        // Una escritura propuesta: el asistente usa el id para dibujar la aprobación en el panel.
        if ("proposed" in result) return { ok: true, mensaje: result.message, propuesta_id: result.proposalId };
        return { ok: true, mensaje: result.message, datos: "data" in result ? result.data ?? null : null };
      },
    });
  }
  return out;
}
