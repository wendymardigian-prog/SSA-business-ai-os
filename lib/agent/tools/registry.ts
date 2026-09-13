import type { AgentConfig } from "../config";
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
  return listAgentTools().filter((tool) => {
    const enabled = tool.required || agent.allowedTools.includes(tool.name);
    if (!enabled) return false;
    return tool.isAvailable ? tool.isAvailable(agent) : true;
  });
}

/** Solo para tests. */
export function resetAgentToolRegistry(): void {
  tools.clear();
}
