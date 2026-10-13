/**
 * La configuracion de los disparadores de Tareas (Extra A, F25). PURA.
 *
 * Filtros opcionales: proyectos (por su clave normalizada) y origenes. VACIO significa «cualquiera», nunca «ninguno». Una
 * configuracion ROTA no dispara para nadie (es mas seguro que mandar a todos).
 */

import { normalizeProjectKey } from "../project";
import { TASK_SOURCES, type TaskSource } from "../types";
import { parseTaskPayload } from "./payload";

export interface TaskTriggerConfig {
  /** Claves de proyecto (`lanzamiento q4`). Vacio = cualquiera. */
  projects: string[];
  /** Origenes (`manual`, `flow`, `agent`, `cx`). Vacio = cualquiera. */
  sources: TaskSource[];
}

/** Lee la config guardada. `null` si esta rota (no dispara). */
export function parseTaskTriggerConfig(config: unknown): TaskTriggerConfig | null {
  if (config == null) return { projects: [], sources: [] };
  if (typeof config !== "object" || Array.isArray(config)) return null;
  const c = config as Record<string, unknown>;

  const list = (value: unknown): string[] | null => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return null;
    return value as string[];
  };

  const projects = list(c.projects);
  const sources = list(c.sources);
  if (!projects || !sources) return null;
  if (!sources.every((s) => (TASK_SOURCES as readonly string[]).includes(s))) return null;

  return {
    projects: [...new Set(projects.map((p) => normalizeProjectKey(p)).filter((p): p is string => !!p))],
    sources: [...new Set(sources)] as TaskSource[],
  };
}

/** ¿El evento cumple los filtros del disparador? */
export function taskEventMatches(config: unknown, payload: unknown): boolean {
  const parsed = parseTaskTriggerConfig(config);
  if (!parsed) return false;
  const p = parseTaskPayload(payload);
  if (!p) return false;
  if (parsed.projects.length > 0 && !parsed.projects.includes(p.project_key)) return false;
  if (parsed.sources.length > 0 && !(parsed.sources as string[]).includes(p.source)) return false;
  return true;
}
