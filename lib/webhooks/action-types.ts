/**
 * Tipos de las Server Actions de webhooks. Van aparte porque un archivo `"use server"` solo puede
 * exportar funciones asincronicas (un `export type` ahi rompe la app en tiempo de ejecucion).
 */
export type WebhookActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface EndpointListItem {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused";
  listening: boolean;
  hasSecret: boolean;
  eventIdPath: string | null;
  lastReceivedAt: string | null;
  received7d: number;
  errors7d: number;
  flows: { id: string; name: string; status: string }[];
  createdAt: string;
}

export interface EndpointDetail extends EndpointListItem {
  /** Solo lo ve quien tiene `webhooks.manage`: es una credencial. */
  url: string;
  urlIsLocal: boolean;
  sample: { payload: Record<string, unknown>; query: Record<string, unknown>; captured_at: string } | null;
  listenUntil: string | null;
}

export interface InboundListItem {
  id: string;
  receivedAt: string;
  status: string;
  hasPayload: boolean;
  resultText: string;
  chip: { label: string; tone: string };
  contactId: string | null;
  reprocessCount: number;
  sizeBytes: number | null;
}

export interface InboundDetailData extends InboundListItem {
  payload: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  result: unknown;
  errorMessage: string | null;
  contentType: string | null;
  ipPrefix: string | null;
  retentionNotice: string | null;
}

// ---------------------------------------------------------------------------
// El editor de flujos (disparador «Webhook recibido» y paso «Crear o actualizar contacto»)
// ---------------------------------------------------------------------------

export interface PickerEndpoint {
  id: string;
  name: string;
  status: "active" | "paused";
  url: string;
  urlIsLocal: boolean;
  lastReceivedAt: string | null;
  listenUntil: string | null;
  sample: { payload: Record<string, unknown>; query: Record<string, unknown>; captured_at: string } | null;
}

export interface UpsertEditorContext {
  sample: { payload: Record<string, unknown>; query: Record<string, unknown> } | null;
  customFields: { slug: string; name: string; type: string }[];
  tags: { id: string; name: string }[];
}

export interface UpsertPreviewRow {
  target: string;
  status: "ok" | "empty" | "error";
  value?: string;
  raw?: string;
  reason?: string;
}

export interface UpsertPreview {
  rows: UpsertPreviewRow[];
  outcome: { kind: "create" } | { kind: "update"; name: string | null } | { kind: "fail"; reason: "no_identifier" | "not_found" };
  tagNames: string[];
  unknownTags: string[];
  /** La atribución que se anotaría: lo mapeado a mano más lo detectado. */
  attribution: Record<string, string>;
  conflicts: number;
}
