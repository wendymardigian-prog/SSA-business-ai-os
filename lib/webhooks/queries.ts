/**
 * Lecturas de las pantallas de webhooks. SOLO servidor.
 *
 * Leen con el cliente de SERVICIO, restringido al workspace de la sesion, y SIEMPRE despues de que
 * quien llama chequeo el permiso en TypeScript (`flows.edit`; `integrations.manage` solo para la
 * lista, sin URL ni payloads). Se lee asi porque la RLS usa `has_permission`, que para el Member de
 * sistema (cuyas claves viven en lib/auth/permissions.ts) devuelve false aunque tenga `flows.edit`.
 * La RLS queda como segunda barrera para cualquier acceso directo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { appUrl } from "@/lib/app-url";
import { isLocalUrl } from "@/lib/webhook-url";
import { isListening } from "./listen";
import { hookUrl } from "./endpoints";
import { describeHistoryRow } from "./history-view";
import type { EndpointDetail, EndpointListItem, InboundDetailData, InboundListItem } from "./action-types";
import type { InboundResult, InboundStatus } from "./types";

type Db = SupabaseClient<Database>;

const DAY_MS = 24 * 60 * 60 * 1000;
export const HISTORY_PAGE_SIZE = 50;

const ENDPOINT_COLUMNS =
  "id, workspace_id, name, description, status, secret_vault_name, event_id_path, listen_until, sample_payload, last_received_at, created_at";

type EndpointRowLite = {
  id: string; name: string; description: string | null; status: "active" | "paused"; secret_vault_name: string | null;
  event_id_path: string | null; listen_until: string | null; sample_payload: EndpointDetail["sample"]; last_received_at: string | null; created_at: string;
};

/** Los flujos que escuchan un endpoint (disparador `webhook_received`). */
export async function flowsUsingEndpoints(db: Db, workspaceId: string, endpointIds?: string[]): Promise<Map<string, { id: string; name: string; status: string }[]>> {
  const out = new Map<string, { id: string; name: string; status: string }[]>();
  const { data } = await db
    .from("triggers")
    .select("config, flows!inner(id, name, status, workspace_id)")
    .eq("type" as never, "webhook_received")
    .eq("flows.workspace_id" as never, workspaceId);
  for (const row of (data ?? []) as unknown as { config: { endpointId?: string } | null; flows: { id: string; name: string; status: string } }[]) {
    const endpointId = row.config?.endpointId;
    if (!endpointId || (endpointIds && !endpointIds.includes(endpointId))) continue;
    const list = out.get(endpointId) ?? [];
    if (!list.some((f) => f.id === row.flows.id)) list.push({ id: row.flows.id, name: row.flows.name, status: row.flows.status });
    out.set(endpointId, list);
  }
  return out;
}

export async function loadEndpointList(db: Db, workspaceId: string, now: Date = new Date()): Promise<EndpointListItem[]> {
  const { data: endpoints } = await db
    .from("webhook_endpoints")
    .select(ENDPOINT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const rows = (endpoints ?? []) as unknown as EndpointRowLite[];
  if (rows.length === 0) return [];

  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const { data: recent } = await db
    .from("inbound_webhooks")
    .select("endpoint_id, status")
    .eq("workspace_id", workspaceId)
    .gte("received_at", since)
    .limit(20000);
  const counts = new Map<string, { total: number; errors: number }>();
  for (const r of (recent ?? []) as { endpoint_id: string; status: string }[]) {
    const c = counts.get(r.endpoint_id) ?? { total: 0, errors: 0 };
    c.total++;
    if (r.status === "error") c.errors++;
    counts.set(r.endpoint_id, c);
  }
  const flows = await flowsUsingEndpoints(db, workspaceId, rows.map((r) => r.id));

  return rows.map((r) => toListItem(r, counts.get(r.id), flows.get(r.id) ?? [], now));
}

function toListItem(r: EndpointRowLite, count: { total: number; errors: number } | undefined, flows: { id: string; name: string; status: string }[], now: Date): EndpointListItem {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status,
    listening: isListening(now, r.listen_until),
    hasSecret: !!r.secret_vault_name,
    eventIdPath: r.event_id_path,
    lastReceivedAt: r.last_received_at,
    received7d: count?.total ?? 0,
    errors7d: count?.errors ?? 0,
    flows,
    createdAt: r.created_at,
  };
}

/** El detalle de UN endpoint, con la URL (credencial). Solo para quien tiene `flows.edit`. */
export async function loadEndpointDetail(db: Db, workspaceId: string, endpointId: string, now: Date = new Date()): Promise<EndpointDetail | null> {
  const { data } = await db
    .from("webhook_endpoints")
    .select(`${ENDPOINT_COLUMNS}, token`)
    .eq("workspace_id", workspaceId)
    .eq("id", endpointId)
    .is("deleted_at", null)
    .maybeSingle();
  const row = data as unknown as (EndpointRowLite & { token: string }) | null;
  if (!row) return null;

  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const { data: recent } = await db.from("inbound_webhooks").select("status").eq("endpoint_id", endpointId).gte("received_at", since).limit(20000);
  const list = (recent ?? []) as { status: string }[];
  const flows = (await flowsUsingEndpoints(db, workspaceId, [endpointId])).get(endpointId) ?? [];
  const base = appUrl();

  return {
    ...toListItem(row, { total: list.length, errors: list.filter((r) => r.status === "error").length }, flows, now),
    url: hookUrl(base, row.token),
    urlIsLocal: !base || isLocalUrl(base),
    sample: row.sample_payload ?? null,
    listenUntil: row.listen_until,
  };
}

export interface HistoryFilters {
  status?: InboundStatus | "all";
  /** Fechas (ISO) del rango, inclusive. */
  from?: string | null;
  to?: string | null;
  page?: number;
}

export async function loadHistory(db: Db, workspaceId: string, endpointId: string, filters: HistoryFilters = {}): Promise<{ items: InboundListItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  let query = db
    .from("inbound_webhooks")
    .select("id, received_at, status, payload, result, error_message, contact_id, reprocess_count, size_bytes", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("endpoint_id", endpointId)
    .order("received_at", { ascending: false })
    .range((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE - 1);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("received_at", filters.from);
  if (filters.to) query = query.lte("received_at", filters.to);
  const { data, count } = await query;

  const items = ((data ?? []) as unknown as RawInbound[]).map(toInboundItem);
  return { items, total: count ?? items.length, page, pageSize: HISTORY_PAGE_SIZE };
}

interface RawInbound {
  id: string; received_at: string; status: InboundStatus; payload: unknown; result: InboundResult | null; error_message: string | null;
  contact_id: string | null; reprocess_count: number; size_bytes: number | null;
}

function toInboundItem(r: RawInbound): InboundListItem {
  const view = describeHistoryRow({ status: r.status, payload: r.payload, result: r.result, error_message: r.error_message });
  return {
    id: r.id,
    receivedAt: r.received_at,
    status: r.status,
    hasPayload: r.payload !== null && r.payload !== undefined,
    resultText: view.resultText,
    chip: view.chip,
    contactId: r.contact_id,
    reprocessCount: r.reprocess_count,
    sizeBytes: r.size_bytes,
  };
}

export async function loadInboundDetail(db: Db, workspaceId: string, inboundId: string): Promise<InboundDetailData | null> {
  const { data } = await db
    .from("inbound_webhooks")
    .select("id, received_at, status, payload, query, result, error_message, contact_id, reprocess_count, size_bytes, content_type, ip_prefix")
    .eq("workspace_id", workspaceId)
    .eq("id", inboundId)
    .maybeSingle();
  const r = data as unknown as (RawInbound & { query: Record<string, unknown> | null; content_type: string | null; ip_prefix: string | null }) | null;
  if (!r) return null;
  const view = describeHistoryRow({ status: r.status, payload: r.payload, result: r.result, error_message: r.error_message });
  return {
    ...toInboundItem(r),
    payload: (r.payload as Record<string, unknown> | null) ?? null,
    query: r.query,
    result: r.result,
    errorMessage: r.error_message,
    contentType: r.content_type,
    ipPrefix: r.ip_prefix,
    retentionNotice: view.retentionNotice,
  };
}
