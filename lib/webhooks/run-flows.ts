/**
 * Corre los flujos publicados que escuchan un envio (F9). En WH1 todavia no hay disparador:
 * devuelve vacio y el envio queda `processed` con "Ningún flujo publicado escucha este webhook".
 * WH2 lo reemplaza con el disparo directo (claim en `trigger_fires` + `executeFlow`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { FlowResult } from "./types";

export interface InboundForFlows {
  id: string;
  workspace_id: string;
  endpoint_id: string;
  payload: Record<string, unknown> | null;
  query: Record<string, unknown> | null;
  received_at: string;
  reprocess_count: number;
}

export interface EndpointForFlows {
  id: string;
  workspace_id: string;
  name: string;
}

export type RunFlows = (args: {
  db: SupabaseClient<Database>;
  inbound: InboundForFlows;
  endpoint: EndpointForFlows;
}) => Promise<Record<string, FlowResult>>;

export const runWebhookFlows: RunFlows = async () => ({});
