/**
 * Los puertos de base del receptor de webhooks entrantes. SOLO servidor: usa el
 * cliente de servicio y Vault.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { checkLimit } from "@/lib/antispam/rate-limit";
import { constantTimeEquals } from "@/lib/crypto";
import { readSecret } from "@/lib/vault";
import { HOOKS_PER_HOUR, HOUR_MS, type EndpointRow, type InboundInsert, type InsertOutcome, type ReceiveDeps } from "./receive";
import type { InboundStatus } from "./types";
import { readBodyCapped } from "./read-body";

type Db = SupabaseClient<Database>;

/** El peso del cuerpo no entra en la tabla de topes: la clave lleva solo el endpoint. */
export const limitKey = (endpointId: string): string => `hooks:${endpointId}`;

export function receiveDeps(db: Db, request: Request): ReceiveDeps {
  return {
    now: () => new Date(),

    async findEndpoint(token: string): Promise<EndpointRow | null> {
      const { data, error } = await db
        .from("webhook_endpoints")
        .select("id, workspace_id, status, secret_vault_name, event_id_path, listen_until")
        .eq("token", token)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error("no pude leer el endpoint");
      return (data as EndpointRow | null) ?? null;
    },

    async readSecret(endpoint: EndpointRow): Promise<string | null> {
      if (!endpoint.secret_vault_name) return null;
      return readSecret(db as never, endpoint.workspace_id, endpoint.secret_vault_name);
    },

    equals: constantTimeEquals,

    limit: async (endpointId: string) => {
      const result = await checkLimit(db, { key: limitKey(endpointId), max: HOOKS_PER_HOUR, windowMs: HOUR_MS });
      return { allowed: result.allowed };
    },

    readBody: () => readBodyCapped(request),

    async insertInbound(row: InboundInsert): Promise<InsertOutcome> {
      // Verificar el repetido y guardar es UNA operacion con candado en la base (00216): dos entregas identicas
      // simultaneas dan un `received` y un `ignored`. Antes eran un SELECT y un INSERT, y pasaban las dos.
      const { data, error } = await db.rpc("receive_inbound_webhook", {
        p_row: {
          workspace_id: row.workspaceId,
          endpoint_id: row.endpointId,
          status: row.status,
          payload: row.payload,
          query: row.query,
          content_type: row.contentType,
          size_bytes: row.sizeBytes,
          ip_prefix: row.ipPrefix,
          user_agent: row.userAgent,
          external_event_id: row.externalEventId,
          body_hash: row.bodyHash,
          error_message: row.errorMessage,
          summary: row.summary,
        } as unknown as Json,
        p_duplicate_window_seconds: Math.round(row.duplicateWindowMs / 1000),
      });
      if (error || !data) throw new Error("no pude guardar el envio");

      const out = data as { kind?: string; id?: string; status?: InboundStatus };
      // El indice unico (endpoint, id de envio): el mismo envio por segunda vez.
      if (out.kind === "duplicate") return { kind: "duplicate" };
      if (out.kind !== "inserted" || !out.id || !out.status) throw new Error("no pude guardar el envio");

      // Para la pantalla ("ultimo envio hace 3 min"). Si falla, no frena nada.
      await db.from("webhook_endpoints").update({ last_received_at: new Date().toISOString() } as never).eq("id", row.endpointId);
      return { kind: "inserted", id: out.id, status: out.status };
    },

    async captureSample(endpointId, sample): Promise<void> {
      await db
        .from("webhook_endpoints")
        .update({ sample_payload: sample as unknown as Json, listen_until: null } as never)
        .eq("id", endpointId);
    },
  };
}
