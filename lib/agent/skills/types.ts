/**
 * Una habilidad del agente: un grupo de herramientas que se prenden juntas,
 * con una configuración compartida (F52).
 *
 * Existe porque agendar no es una herramienta: son siete, y todas necesitan
 * lo mismo (qué eventos puede ofrecer, si puede cancelar, cuántos días mirar).
 * Pedirle a la persona que prenda siete interruptores y configure el mismo
 * dato en cada uno sería siete veces la misma decisión.
 *
 * Sin dependencias de servidor salvo zod: la pantalla lee la descripción
 * plana, igual que con las herramientas.
 */

import type { z } from "zod";
import type { ToolConfigField } from "../tools/types";

export interface AgentSkillDefinition<TConfig = unknown> {
  /** Clave en `agents.tools_config`. snake_case. */
  key: string;
  label: string;
  /** Para la pantalla: qué gana el agente con esto. */
  description: string;
  configSchema: z.ZodType<TConfig>;
  configFields: ToolConfigField[];
  /** Los nombres de las herramientas que se prenden con la habilidad. */
  tools: string[];
  /**
   * El bloque de instrucciones que se suma al prompt cuando está encendida.
   * Recibe la configuración ya validada.
   */
  instructions(config: TConfig): string;
}
