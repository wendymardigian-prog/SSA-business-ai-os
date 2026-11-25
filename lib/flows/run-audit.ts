/**
 * Lo auditable de una ejecución: el webhook que la arrancó (datos, URL y cabeceras) y, por paso, con qué datos corrió y
 * qué dejó (00515). Tiene datos personales: la sesión del navegador no puede leerlo (privilegio por columna). Se lee con
 * el cliente de SERVICIO, y solo después de que la página comprobó con la sesión que la persona ve esa ejecución y tiene
 * `flows.edit`. Filtra siempre por el negocio y el flujo. Nunca lanza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { normalizePayload } from "@/lib/webhooks/normalize";

type Db = SupabaseClient<Database>;

export interface RunWebhookAudit {
  id: string;
  endpointName: string | null;
  receivedAt: string;
  contentType: string | null;
  status: string;
  payload: unknown;
  query: unknown;
  headers: Record<string, string> | null;
  /** La copia normalizada (`{{webhook.data.…}}`): lo que se puede usar como variable. */
  data: Record<string, unknown>;
  /** Los datos se borraron (90 días). */
  cleared: boolean;
}

export interface RunStepAudit {
  input: unknown;
  output: unknown;
}

export interface RunAudit {
  webhook: RunWebhookAudit | null;
  steps: Record<string, RunStepAudit>;
}

export async function loadFlowRunAudit(service: Db, args: { workspaceId: string; flowId: string; runId: string }): Promise<RunAudit | null> {
  try {
    // La ejecución tiene que ser de un flujo de ESTE negocio.
    const { data: flow } = await service.from("flows").select("id").eq("id", args.flowId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!flow) return null;
    const { data: session } = await service
      .from("flow_sessions")
      .select("id, inbound_webhook_id")
      .eq("id", args.runId)
      .eq("flow_id", args.flowId)
      .maybeSingle();
    if (!session) return null;

    const inboundId = (session as { inbound_webhook_id?: string | null }).inbound_webhook_id ?? null;
    const [webhookRes, stepsRes] = await Promise.all([
      inboundId
        ? service
            .from("inbound_webhooks")
            .select("id, endpoint_id, received_at, content_type, status, payload, query, headers")
            .eq("id", inboundId)
            .eq("workspace_id", args.workspaceId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      service.from("flow_session_steps").select("id, input, output").eq("session_id", args.runId).limit(500),
    ]);

    let webhook: RunWebhookAudit | null = null;
    const row = webhookRes.data as {
      id: string;
      endpoint_id: string;
      received_at: string;
      content_type: string | null;
      status: string;
      payload: unknown;
      query: unknown;
      headers: unknown;
    } | null;
    if (row) {
      const { data: endpoint } = await service.from("webhook_endpoints").select("name").eq("id", row.endpoint_id).eq("workspace_id", args.workspaceId).maybeSingle();
      webhook = {
        id: row.id,
        endpointName: (endpoint as { name?: string } | null)?.name ?? null,
        receivedAt: row.received_at,
        contentType: row.content_type,
        status: row.status,
        payload: row.payload ?? null,
        query: row.query ?? null,
        headers: row.headers && typeof row.headers === "object" ? (row.headers as Record<string, string>) : null,
        data: normalizePayload(row.payload ?? {}),
        cleared: row.payload === null,
      };
    }

    const steps: Record<string, RunStepAudit> = {};
    for (const s of (stepsRes.data ?? []) as Array<{ id: string; input: unknown; output: unknown }>) {
      if (s.input != null || s.output != null) steps[s.id] = { input: s.input ?? null, output: s.output ?? null };
    }
    return { webhook, steps };
  } catch (err) {
    console.error("[flows] no pude leer los datos de auditoría de la ejecución:", err instanceof Error ? err.name : "error");
    return null;
  }
}
