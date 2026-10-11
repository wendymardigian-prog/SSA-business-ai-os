/**
 * Cómo se llaman los estados de una firma en la pantalla (F28). PURO.
 * Los estados visibles del email son tres: Enviado, Reintentando y No enviado.
 */
import type { ContractEmailStatus, ContractPdfStatus } from "@/lib/types/database";

export const PDF_STATUS_LABELS: Record<ContractPdfStatus, string> = {
  pending: "Generándose",
  generated: "Listo",
  failed: "No se pudo generar",
};

export const EMAIL_STATUS_LABELS: Record<ContractEmailStatus, string> = {
  pending: "Pendiente",
  sent: "Enviado",
  retrying: "Reintentando",
  not_sent: "No enviado",
};

export type StatusTone = "ok" | "wait" | "bad";

export function pdfTone(status: ContractPdfStatus): StatusTone {
  return status === "generated" ? "ok" : status === "failed" ? "bad" : "wait";
}

export function emailTone(status: ContractEmailStatus): StatusTone {
  return status === "sent" ? "ok" : status === "not_sent" ? "bad" : "wait";
}

/** "Ver PDF" solo con el PDF listo. */
export function canViewPdf(pdf: ContractPdfStatus): boolean {
  return pdf === "generated";
}

/** "Reenviar copia" necesita un PDF listo. */
export function canResend(pdf: ContractPdfStatus): boolean {
  return pdf === "generated";
}

/** "Regenerar PDF" solo cuando falló. */
export function canRegenerate(pdf: ContractPdfStatus): boolean {
  return pdf === "failed";
}
