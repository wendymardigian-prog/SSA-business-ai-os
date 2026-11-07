/**
 * Reintentar solo un paso cuando el proveedor tuvo un problema pasajero (Instagram limitando, Zernio con un 5xx).
 *
 * Mismo esquema que el resto del sistema: a 1, 5 y 15 minutos, y despues el paso queda como fallido con su motivo. El
 * paso no lanza (la cola reintentaria a los 10 segundos encima de esta espera): se deja para despues con
 * `deferFlowNode`, que vuelve a correr el MISMO paso.
 *
 * La cuenta de intentos viaja en las variables de la sesion (`__provider_retries`), por paso. Se borra cuando el paso
 * sale bien o se rinde, asi una segunda pasada por el mismo paso (un ciclo) arranca de cero.
 */
import type { FlowExecutionContext } from "./types";

export const PROVIDER_RETRY_VAR = "__provider_retries";

/** Minutos de espera de cada reintento. */
export const PROVIDER_RETRY_DELAYS_MIN = [1, 5, 15] as const;

function retries(context: FlowExecutionContext): Record<string, number> {
  const raw = (context.variables as Record<string, unknown> | undefined)?.[PROVIDER_RETRY_VAR];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, number>) : {};
}

/**
 * Cuando reintentar el paso, o null si ya se usaron los tres intentos. Suma el intento en las variables del contexto
 * (las guarda `deferFlowNode` en la sesion).
 */
export function nextProviderRetry(context: FlowExecutionContext, nodeId: string, now: Date = new Date()): Date | null {
  const done = retries(context)[nodeId] ?? 0;
  const delay = PROVIDER_RETRY_DELAYS_MIN[done];
  if (delay === undefined) return null;
  const variables = { ...((context.variables ?? {}) as Record<string, unknown>) };
  variables[PROVIDER_RETRY_VAR] = { ...retries(context), [nodeId]: done + 1 };
  context.variables = variables as FlowExecutionContext["variables"];
  return new Date(now.getTime() + delay * 60_000);
}

/** Olvida los intentos de un paso (salio bien o se rindio). */
export function clearProviderRetry(context: FlowExecutionContext, nodeId: string): void {
  const all = retries(context);
  if (!(nodeId in all)) return;
  const rest = { ...all };
  delete rest[nodeId];
  const variables = { ...((context.variables ?? {}) as Record<string, unknown>) };
  if (Object.keys(rest).length > 0) variables[PROVIDER_RETRY_VAR] = rest;
  else delete variables[PROVIDER_RETRY_VAR];
  context.variables = variables as FlowExecutionContext["variables"];
}

/** El motivo de un paso que quedo para reintentar. La hora la muestra el historial (`resumes_at`). */
export function retryNote(message: string, attempt: number): string {
  return `${message} Se vuelve a intentar solo (intento ${attempt} de ${PROVIDER_RETRY_DELAYS_MIN.length}).`;
}
