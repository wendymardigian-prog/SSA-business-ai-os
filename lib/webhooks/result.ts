/**
 * Cierre del procesamiento de un envio (F15): el estado final y el resumen legible a partir de
 * lo que paso con cada flujo. Puro.
 */
import type { FlowResult, InboundStatus } from "./types";

export interface ResultSummary {
  status: Extract<InboundStatus, "processed" | "error">;
  summary: string;
  /** El error del primer flujo que fallo. */
  errorMessage: string | null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `${n} ${one}` : `${n} ${many}`);

export function summarizeResult(flows: Record<string, FlowResult>): ResultSummary {
  const list = Object.values(flows);
  if (list.length === 0) {
    return { status: "processed", summary: "Ningún flujo publicado escucha este webhook", errorMessage: null };
  }

  const failed = list.filter((f) => f.status === "failed");
  if (failed.length > 0) {
    const first = failed[0].error ?? "falló sin detalle";
    return {
      status: "error",
      summary: `${failed.length} de ${list.length} ${list.length === 1 ? "flujo" : "flujos"} ${failed.length === 1 ? "falló" : "fallaron"}: ${first}`,
      errorMessage: first,
    };
  }

  const pending = list.filter((f) => f.status === "pending").length;
  const completed = list.filter((f) => f.status === "completed").length;
  const skipped = list.filter((f) => f.status === "skipped_condition").length;

  const parts: string[] = [];
  if (completed > 0) parts.push(plural(completed, "flujo corrió", "flujos corrieron"));
  if (pending > 0) parts.push(plural(pending, "flujo en curso", "flujos en curso"));
  if (completed === 0 && pending === 0 && skipped > 0) parts.push("no cumplió la condición");
  else if (skipped > 0) parts.push(plural(skipped, "no cumplió la condición", "no cumplieron la condición"));

  return { status: "processed", summary: parts.join(", "), errorMessage: null };
}

/** El ultimo contacto que toco cualquier flujo (para `inbound_webhooks.contact_id`). */
export function lastContactId(flows: Record<string, FlowResult>): string | null {
  const ids = Object.values(flows)
    .map((f) => f.contact_id)
    .filter((id): id is string => typeof id === "string" && id !== "");
  return ids.length > 0 ? ids[ids.length - 1] : null;
}
