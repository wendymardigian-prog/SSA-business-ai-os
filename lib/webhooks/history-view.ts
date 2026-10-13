/**
 * Que chip y que texto muestra el historial de un envio (F4). Puro: la pantalla
 * solo compone lo que sale de aca.
 */
import type { FlowResult, InboundResult, InboundStatus } from "./types";

export type ChipTone = "neutral" | "info" | "success" | "danger" | "warning";

export interface HistoryRowInput {
  status: InboundStatus;
  /** null cuando la retencion ya lo vacio (a los 90 dias). */
  payload: unknown;
  result: InboundResult | null;
  error_message: string | null;
}

export interface HistoryRowView {
  chip: { label: string; tone: ChipTone };
  /** "Contacto creado: Ana Perez", "Actualizado", "Sin contacto", "Error: …" o un texto de estado. */
  resultText: string;
  /** El aviso cuando el payload ya se vacio. */
  retentionNotice: string | null;
}

export const RETENTION_NOTICE = "Los datos de este envío se borraron a los 90 días";

const CHIPS: Record<InboundStatus, { label: string; tone: ChipTone }> = {
  received: { label: "Recibido", tone: "info" },
  processing: { label: "Procesando", tone: "info" },
  processed: { label: "Procesado", tone: "success" },
  error: { label: "Con error", tone: "danger" },
  ignored: { label: "Ignorado", tone: "neutral" },
  captured: { label: "Capturado", tone: "warning" },
  paused: { label: "Pausado", tone: "neutral" },
};

const flowsOf = (result: InboundResult | null): FlowResult[] => Object.values(result?.flows ?? {});

export function contactOutcomeText(flow: FlowResult): string | null {
  if (flow.contact_result === "created") return flow.contact_name ? `Contacto creado: ${flow.contact_name}` : "Contacto creado";
  if (flow.contact_result === "updated") return flow.contact_name ? `Actualizado: ${flow.contact_name}` : "Actualizado";
  if (flow.contact_result === "unchanged") return flow.contact_name ? `Sin cambios: ${flow.contact_name}` : "Sin cambios";
  return null;
}

export function describeHistoryRow(row: HistoryRowInput): HistoryRowView {
  const chip = CHIPS[row.status] ?? CHIPS.received;
  const retentionNotice = row.payload === null || row.payload === undefined ? RETENTION_NOTICE : null;
  const flows = flowsOf(row.result);

  let resultText: string;
  if (row.status === "error") {
    const failed = flows.find((f) => f.status === "failed");
    resultText = `Error: ${failed?.error ?? row.error_message ?? "no se pudo procesar"}`;
  } else if (row.status === "ignored") {
    resultText = row.result?.summary ?? "Repetido";
  } else if (row.status === "captured") {
    resultText = "Guardado como ejemplo (no corrió ningún flujo)";
  } else if (row.status === "paused") {
    resultText = "El endpoint estaba pausado (no corrió ningún flujo)";
  } else if (row.status === "received" || row.status === "processing") {
    resultText = "En cola";
  } else {
    const withContact = flows.map(contactOutcomeText).find((t): t is string => t !== null);
    if (withContact) resultText = withContact;
    else if (flows.some((f) => f.contact_fail_reason || (f.status === "completed" && !f.contact_id))) resultText = "Sin contacto";
    else resultText = row.result?.summary ?? (flows.length === 0 ? "Ningún flujo publicado escucha este webhook" : "Procesado");
  }

  return { chip, resultText, retentionNotice };
}
