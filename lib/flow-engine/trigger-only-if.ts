/**
 * «Solo si…» en el disparador: condiciones extra que tienen que cumplirse para que la automatización arranque. Mismo
 * editor y mismo evaluador que el paso «Condiciones» (`condition-eval.ts`, `resolveBranchFields`): los datos del
 * disparador (venta, servicio, reunión…) y los del contacto.
 *
 * Reglas:
 *  - Se guarda en la config del disparador como `onlyIf: { logic, conditions }`. Sin condiciones, corre siempre.
 *  - Lo evalúa el motor ANTES de reclamar el disparo (`trigger_fires`): si no se cumple, no se gasta la marca y la
 *    persona puede volver a entrar más adelante, cuando sí se cumpla.
 *  - Nunca lanza: un campo que no se puede leer hace que esa condición no se cumpla.
 *  - Solo en los disparadores que pasan por la cola de eventos (`supportsTriggerOnlyIf`). El webhook tiene el suyo
 *    (`conditions`) y los de mensajes conservan sus filtros de siempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { evaluateGroupDetailed, type BranchCondition, type ConditionGroup } from "./condition-eval";
import type { FlowExecutionContext } from "./types";

export const TRIGGER_ONLY_IF_KEY = "onlyIf";

/** Lo guardado, o null si no hay condiciones (o si está roto: un «Solo si…» ilegible no deja de filtrar en silencio). */
export function readTriggerOnlyIf(config: unknown): ConditionGroup | null {
  const raw = (config && typeof config === "object" ? (config as Record<string, unknown>)[TRIGGER_ONLY_IF_KEY] : null) as unknown;
  if (!raw || typeof raw !== "object") return null;
  const group = raw as { logic?: unknown; conditions?: unknown };
  if (!Array.isArray(group.conditions) || group.conditions.length === 0) return null;
  return { logic: group.logic === "or" ? "or" : "and", conditions: group.conditions as BranchCondition[] };
}

/** Lo que se escribe en el nodo: el grupo, o nada si quedó vacío. */
export function writeTriggerOnlyIf(group: { logic: "and" | "or"; conditions: BranchCondition[] } | null): ConditionGroup | undefined {
  if (!group || group.conditions.length === 0) return undefined;
  return { logic: group.logic, conditions: group.conditions };
}

/** Los disparadores con «Solo si…» genérico: los que atienden eventos de la cola, menos el webhook (tiene el suyo). */
export function supportsTriggerOnlyIf(definition: { type: string; eventTypes?: readonly string[] } | undefined | null): boolean {
  if (!definition) return false;
  if (definition.type === "webhook_received") return false;
  return Array.isArray(definition.eventTypes) && definition.eventTypes.length > 0;
}

export interface OnlyIfResult {
  passed: boolean;
  /** Por condición: qué campo y si se cumplió. Nunca el valor (puede ser un dato personal). */
  checks: Array<{ field: string; operator: string; ok: boolean; missing?: boolean; error?: boolean }>;
}

/**
 * ¿Se cumple? Resuelve los campos como el paso «Condiciones» (el contacto se carga solo si alguna condición lo mira).
 * Nunca lanza: ante cualquier error, no se cumple.
 */
export async function evaluateTriggerOnlyIf(
  supabase: SupabaseClient<Database>,
  group: ConditionGroup,
  context: Pick<FlowExecutionContext, "workspaceId" | "contactId" | "flowId" | "triggerId" | "variables"> & { memberUserId?: string | null },
): Promise<OnlyIfResult> {
  try {
    // Import diferido: el nodo de «Condiciones» arrastra el registro de campos y no hace falta para leer la config.
    const { resolveBranchFields } = await import("./nodes/branch");
    const full = { channelId: "", conversationId: "", incomingMessage: {}, ...context } as FlowExecutionContext;
    const resolve = await resolveBranchFields(supabase, full, group.conditions);
    const result = evaluateGroupDetailed(group, resolve);
    return { passed: result.passed, checks: result.checks.map((c) => ({ field: c.field, operator: c.operator, ok: c.ok, ...(c.missing ? { missing: true } : {}), ...(c.error ? { error: true } : {}) })) };
  } catch (error) {
    console.error("[automatizaciones] no pude evaluar el «Solo si…»:", error instanceof Error ? error.message : "error");
    return { passed: false, checks: [] };
  }
}
