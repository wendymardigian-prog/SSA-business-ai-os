/**
 * Formas compartidas de los webhooks entrantes. Sin dependencias: lo importan
 * la pantalla, el procesamiento y los tests.
 */
export type InboundStatus = "received" | "processing" | "processed" | "error" | "ignored" | "captured" | "paused";

export type ContactResult = "created" | "updated" | "unchanged";

/** Lo que paso con UN flujo ante UN envio (`inbound_webhooks.result.flows[flowId]`). */
export interface FlowResult {
  /** `pending` = quedo esperando (un "Esperar"); `skipped_condition` = "Solo si…" no se cumplio. */
  status: "completed" | "failed" | "skipped_condition" | "pending";
  flow_name?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  contact_result?: ContactResult | null;
  /** Por que el paso de contacto salio por "No se pudo". */
  contact_fail_reason?: string | null;
  diff?: Record<string, { before: unknown; after: unknown }> | null;
  touch_id?: string | null;
  /** Un conflicto de dedupe (telefono de uno, email de otro): no se fusiona nada. */
  conflict?: { contact_id: string; by: string }[] | null;
  /** Pasos salteados porque no habia contacto. */
  skipped_steps?: string[] | null;
  error?: string | null;
  finished_at?: string | null;
}

export interface InboundResult {
  flows?: Record<string, FlowResult>;
  summary?: string | null;
}
