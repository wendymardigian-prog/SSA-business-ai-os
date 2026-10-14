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
  /** El toque que se anotó (si se pudo): fuente, medio, campaña y anuncio. */
  touch?: { recorded: boolean; source: string; medium: string | null; campaign?: string | null; content?: string | null; ad_id?: string | null } | null;
  touch_id?: string | null;
  /** Un conflicto de dedupe (telefono de uno, email de otro): no se fusiona nada. */
  conflict?: { contact_id: string; by: string }[] | null;
  /** Pasos salteados porque no habia contacto. */
  skipped_steps?: string[] | null;
  /** Lo que no se pudo guardar del contacto (un pais o un usuario que no se reconoce, un tag que no existe). */
  notes?: string[] | null;
  /**
   * Un REPROCESO que no volvio a correr este flujo (ya habia corrido) pero SI volvio a mapear el contacto:
   * el flujo y sus mensajes no se repiten; el contacto se completa con el mapeo actual (Tiron 2, C2).
   */
  contact_remapped?: boolean | null;
  error?: string | null;
  finished_at?: string | null;
}

export interface InboundResult {
  flows?: Record<string, FlowResult>;
  summary?: string | null;
}
