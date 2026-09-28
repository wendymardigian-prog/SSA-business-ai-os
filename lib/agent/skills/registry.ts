/**
 * Registro de habilidades (F52). Mismo patrón que el de herramientas: alta
 * explícita, clave única, y todo el que necesita la lista la lee de acá.
 */

import type { AgentSkillDefinition } from "./types";

const skills = new Map<string, AgentSkillDefinition<unknown>>();

export function registerAgentSkill<TConfig>(definition: AgentSkillDefinition<TConfig>): void {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(definition.key)) {
    throw new Error(`Clave de habilidad invalida: "${definition.key}" (snake_case)`);
  }
  if (skills.has(definition.key)) {
    throw new Error(`Habilidad duplicada en el registro: "${definition.key}"`);
  }
  skills.set(definition.key, definition as AgentSkillDefinition<unknown>);
}

export function getAgentSkill(key: string): AgentSkillDefinition<unknown> | undefined {
  return skills.get(key);
}

export function listAgentSkills(): AgentSkillDefinition<unknown>[] {
  return [...skills.values()];
}

/** Las claves de `tools_config` que son habilidades, para no borrarlas. */
export function skillKeys(): string[] {
  return [...skills.keys()];
}

/**
 * ¿Está encendida esta habilidad para este agente?
 *
 * La marca vive en su propia configuración (`tools_config.<key>.habilitada`),
 * no en `allowedTools`: `allowedTools` guarda herramientas y una habilidad no
 * lo es.
 */
export function isSkillEnabled(toolsConfig: Record<string, unknown> | null | undefined, key: string): boolean {
  const config = (toolsConfig ?? {})[key];
  return Boolean(config && typeof config === "object" && (config as { habilitada?: unknown }).habilitada === true);
}

/** Solo para tests. */
export function resetAgentSkillRegistry(): void {
  skills.clear();
}
