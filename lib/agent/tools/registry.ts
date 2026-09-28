import type { AgentConfig } from "../config";
import { isSkillEnabled, listAgentSkills } from "../skills/registry";
import type { AgentToolDefinition } from "./types";

/**
 * Registro de herramientas del agente. Mismo patron que el registro de nodos
 * de la Fase 2 (lib/flow-engine/registry): alta explicita, nombre unico, y
 * todo el que necesita la lista la lee de aca.
 */

const tools = new Map<string, AgentToolDefinition<unknown, unknown>>();

export function registerAgentTool<TInput, TConfig>(definition: AgentToolDefinition<TInput, TConfig>): void {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(definition.name)) {
    throw new Error(`Nombre de herramienta invalido: "${definition.name}" (snake_case)`);
  }
  if (tools.has(definition.name)) {
    throw new Error(`Herramienta duplicada en el registro: "${definition.name}"`);
  }
  tools.set(definition.name, definition as AgentToolDefinition<unknown, unknown>);
}

export function getAgentTool(name: string): AgentToolDefinition<unknown, unknown> | undefined {
  return tools.get(name);
}

export function listAgentTools(): AgentToolDefinition<unknown, unknown>[] {
  return [...tools.values()];
}

/**
 * Las herramientas que el agente tiene en este turno: las obligatorias mas las
 * habilitadas, y de esas solo las que aplican (isAvailable).
 */
export function toolsForAgent(agent: AgentConfig): AgentToolDefinition<unknown, unknown>[] {
  // Las herramientas de una habilidad encendida entran sin estar en
  // `allowedTools`: una habilidad se prende de una vez, no herramienta por
  // herramienta. Sigue mandando `isAvailable`, así una habilidad a medio
  // configurar no ofrece nada.
  const fromSkills = new Set(
    listAgentSkills()
      .filter((skill) => isSkillEnabled(agent.toolsConfig, skill.key))
      .flatMap((skill) => skill.tools),
  );

  return listAgentTools().filter((tool) => {
    const enabled = tool.required || agent.allowedTools.includes(tool.name) || fromSkills.has(tool.name);
    if (!enabled) return false;
    return tool.isAvailable ? tool.isAvailable(agent) : true;
  });
}

/**
 * Las herramientas de ESTE turno, segun como entrega.
 *
 * Cuando el turno redacta en vez de enviar (borrador, o la simulacion de
 * reglas), las marcadas `hideInDraft` no se ofrecen: su efecto sale del
 * sistema y no se puede deshacer descartando el borrador.
 */
export function toolsForTurn(
  agent: AgentConfig,
  options: { mode?: "send" | "draft" | "rules" } = {},
): AgentToolDefinition<unknown, unknown>[] {
  const redacta = options.mode === "draft" || options.mode === "rules";
  return toolsForAgent(agent).filter((tool) => !(redacta && tool.hideInDraft));
}

/** Solo para tests. */
export function resetAgentToolRegistry(): void {
  tools.clear();
}
