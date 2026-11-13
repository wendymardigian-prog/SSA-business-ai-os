/**
 * Lo que necesita el análisis para proponer acciones (Servicios A4, F142). Solo servidor (lo usa el job
 * `call_analyze`, con el cliente de servicio).
 *
 * Tolerante a propósito: si algo no se puede leer (la columna todavía no está, el módulo apagado), NO se propone nada
 * y el análisis sigue igual que siempre. Nunca hace fallar un análisis.
 */
import { svcSchema } from "@/lib/services/db";
import { buildProposalsInstructions, readProposalsConfig, shouldPropose, type ProposalServiceContext, type ProposalsConfig } from "./proposals";

type AnyDb = { from: (t: string) => unknown };

export type ProposalsSetup = {
  config: ProposalsConfig;
  /** null = esta corrida no propone. */
  instructions: string | null;
  pendingItemKeys: string[];
  serviceOwnerId: string | null;
};

const OFF: ProposalsSetup = { config: { enabled: false, client_message: false }, instructions: null, pendingItemKeys: [], serviceOwnerId: null };

export async function loadProposalsSetup(
  db: AnyDb,
  input: { workspaceId: string; profileId: string; shape: string; transcriptChars: number; contactId: string | null; serviceId: string | null },
): Promise<ProposalsSetup> {
  try {
    const q = db.from("call_analysis_profiles") as { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } } };
    const { data, error } = await q.select("proposals").eq("id", input.profileId).maybeSingle();
    if (error || !data) return OFF;
    const config = readProposalsConfig((data as { proposals?: unknown }).proposals);
    if (!shouldPropose({ config, shape: input.shape, transcriptChars: input.transcriptChars })) return { ...OFF, config };

    let service: ProposalServiceContext = null;
    let pendingItemKeys: string[] = [];
    let serviceOwnerId: string | null = null;
    if (input.serviceId) {
      const sch = svcSchema(db);
      const { data: s } = await sch.from("services").select("id, owner_user_id, product_snapshot").eq("id", input.serviceId).eq("workspace_id", input.workspaceId).maybeSingle();
      if (s) {
        const row = s as { id: string; owner_user_id: string | null; product_snapshot: { product_name?: string; variant_name?: string } | null };
        serviceOwnerId = row.owner_user_id;
        const [{ data: phases }, { data: items }] = await Promise.all([
          sch.from("service_phases").select("id, name, status").eq("service_id", row.id),
          sch.from("service_items").select("template_key, name, status, is_recurring_template, position, phase_id").eq("service_id", row.id).eq("status", "pending").eq("is_recurring_template", false).order("position").limit(60),
        ]);
        const current = ((phases ?? []) as Array<{ id: string; name: string; status: string }>).find((p) => p.status === "in_progress") ?? null;
        const pend = ((items ?? []) as Array<{ template_key: string | null; name: string }>).filter((i) => i.template_key);
        pendingItemKeys = [...new Set(pend.map((i) => i.template_key as string))];
        service = {
          product: row.product_snapshot?.product_name ?? "",
          variant: row.product_snapshot?.variant_name ?? "",
          phase: current?.name ?? null,
          pendingItems: pend.map((i) => ({ key: i.template_key as string, name: i.name })),
        };
      }
    }
    return {
      config,
      instructions: buildProposalsInstructions({ service, hasContact: Boolean(input.contactId), clientMessage: config.client_message }),
      pendingItemKeys,
      serviceOwnerId,
    };
  } catch (error) {
    console.error("[propuestas] no pude armar el contexto:", error instanceof Error ? error.message : error);
    return OFF;
  }
}
