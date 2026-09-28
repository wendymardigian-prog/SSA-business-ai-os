/**
 * Alta de la habilidad de agendamiento (F52 a F56).
 *
 * Las siete herramientas se registran siempre, pero ninguna se ofrece si la
 * habilidad está apagada o no tiene eventos elegidos (`isAvailable`). Así, con
 * la habilidad apagada, el agente ve exactamente las mismas herramientas que
 * antes de esta etapa: hay un test que lo comprueba.
 */

import { registerAgentTool } from "../registry";
import type { AgentToolDefinition } from "../types";
import { registerAgentSkill } from "@/lib/agent/skills/registry";
import { schedulingReadTools } from "./read-tools";
import { schedulingActionTools } from "./action-tools";
import { schedulingSkillFields, schedulingSkillSchema, type SchedulingSkillConfig } from "./config";
import { buildSchedulingInstructions } from "./instructions";

export const SCHEDULING_SKILL_KEY = "scheduling";

// El tipo se ensancha a propósito: cada herramienta tiene su propio esquema de
// entrada, y el registro las guarda con el tipo laxo igual que las demás.
export const schedulingTools: AgentToolDefinition<unknown, unknown>[] = [
  ...schedulingReadTools,
  ...schedulingActionTools,
] as unknown as AgentToolDefinition<unknown, unknown>[];

export function registerSchedulingSkill(): void {
  for (const tool of schedulingTools) registerAgentTool(tool);

  registerAgentSkill<SchedulingSkillConfig>({
    key: SCHEDULING_SKILL_KEY,
    label: "Agendamiento",
    description:
      "El agente puede ofrecer horarios de verdad y agendar. Los horarios salen de la misma consulta que la página pública, así que nunca propone uno que no exista.",
    configSchema: schedulingSkillSchema,
    configFields: schedulingSkillFields,
    tools: schedulingTools.map((t) => t.name),
    instructions: buildSchedulingInstructions,
  });
}

export { schedulingSkillSchema, schedulingSkillFields, buildSchedulingInstructions };
export * from "./config";
export * from "./timezone";
