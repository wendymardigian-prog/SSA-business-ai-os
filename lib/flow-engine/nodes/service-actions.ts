// @plantilla-quitar(servicios)
/**
 * Las acciones de Servicios en Automatizaciones (F25, bloque SV2):
 *   - «Completar un paso del servicio»  (svc_complete_step)
 *   - «Cambiar de fase»                 (svc_change_phase)
 *   - «Empezar la fase Reto»            (svc_start_challenge)
 *   - «Extender servicio»               (svc_extend_service)
 *   - «Pausar servicio»                 (svc_pause_service)
 *   - «Emitir certificado»              (svc_issue_certificate, bloque CE: con la plantilla del paso Certificado)
 * Las de accesos, modulos e invitacion las suman los bloques AC y PR.
 *
 * Sobre que servicio: el del evento que disparo el flujo (`service_id` en el payload, que llega como
 * `event_service_id`) o, si el evento no lo trae, el servicio activo mas reciente del contacto (del
 * producto elegido, si se eligio uno). Las funciones de la base corren como sistema (sin sesion) y nunca
 * frenan el flujo: un problema se anota en el paso y el flujo sigue.
 */
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { interpolateVariables } from "../interpolate";
import { svcRpc, svcSchema } from "@/lib/services/db";
import { SERVICE_ACTION_LABELS as LABELS, SERVICE_ACTION_TYPES, type ServiceActionData, type ServiceActionType } from "./service-action-detail";
export { SERVICE_ACTION_TYPES, serviceActionDetail, type ServiceActionData, type ServiceActionType } from "./service-action-detail";
import { issueCertificateCore } from "@/lib/services/certificate-core";
import { loadModuleDesignExtensions } from "@/lib/designer/module-extensions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El servicio sobre el que actua la accion. */
export async function resolveServiceForFlow(
  supabase: unknown,
  workspaceId: string,
  contactId: string | null,
  variables: Record<string, unknown>,
  productId: string | null | undefined,
): Promise<string | null> {
  const fromEvent = variables.event_service_id;
  if (typeof fromEvent === "string" && UUID.test(fromEvent)) return fromEvent;
  if (!contactId) return null;
  let q = svcSchema(supabase)
    .from("services")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (productId && UUID.test(productId)) q = q.eq("product_id", productId);
  const { data } = await q.maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

function makeExecute(type: ServiceActionType) {
  return async ({ supabase, data, context, node }: NodeExecutionArgs<ServiceActionData>): Promise<void> => {
    const vars = context.variables ?? {};
    const note = (status: "skipped" | "failed", reason: string) => {
      console.warn(`[flow-engine] el nodo ${node.id} (${type}) ${status === "failed" ? "fallo" : "se saltea"}: ${reason}`);
      context.noteStep?.({ status, reason });
    };
    const serviceId = await resolveServiceForFlow(supabase, context.workspaceId, context.contactId ?? null, vars, data.productId);
    if (!serviceId) return note("skipped", "El contacto no tiene un servicio activo.");
    const reason = interpolateVariables(String(data.reason ?? ""), vars).trim() || "Automatización";

    let res: { ok: boolean; error?: { message: string } };
    switch (type) {
      case "svc_complete_step": {
        if (!data.itemKey) return note("skipped", "Falta elegir el paso.");
        const { data: items } = await svcSchema(supabase)
          .from("service_items")
          .select("id, status, occurrence_index")
          .eq("service_id", serviceId)
          .eq("template_key", data.itemKey)
          .eq("status", "pending")
          .eq("is_recurring_template", false)
          .order("occurrence_index", { ascending: true, nullsFirst: true })
          .limit(1);
        const item = (items as Array<{ id: string }> | null)?.[0];
        if (!item) return note("skipped", "Ese paso no está pendiente en el servicio.");
        res = await svcRpc(supabase, "svc_mark_item", { p_item_id: item.id, p_source: "automation", p_by_kind: "system", p_by: null });
        break;
      }
      case "svc_change_phase": {
        if (!data.phaseKey) return note("skipped", "Falta elegir la fase.");
        const { data: phase } = await svcSchema(supabase).from("service_phases").select("id").eq("service_id", serviceId).eq("template_key", data.phaseKey).maybeSingle();
        if (!phase) return note("skipped", "El servicio no tiene esa fase.");
        res = await svcRpc(supabase, "svc_move_core", { p_service_id: serviceId, p_phase_id: (phase as { id: string }).id, p_reason: reason });
        break;
      }
      case "svc_start_challenge":
        res = await svcRpc(supabase, "svc_start_challenge", { p_service_id: serviceId, p_actor: "automation" });
        break;
      case "svc_extend_service":
        if (!data.n || data.n < 1) return note("skipped", "Falta elegir cuánto se extiende.");
        res = await svcRpc(supabase, "svc_extend", {
          p_service_id: serviceId,
          p: { mode: "period", n: data.n, unit: data.unit === "months" ? "months" : "days", from: data.from ?? null, kind: "bonus", reason },
        });
        break;
      case "svc_pause_service":
        res = await svcRpc(supabase, "svc_pause", {
          p_service_id: serviceId,
          p: { reason, cut_access: data.cutAccess !== false, resume_on: data.resumeOn ?? null },
        });
        break;
      case "svc_issue_certificate": {
        // Uno vigente por servicio: si ya tiene uno, no genera otro. El paso Certificado se completa cuando el Diseñador
        // termina de generarlo (F68), venga de donde venga.
        loadModuleDesignExtensions();
        const out = await issueCertificateCore(supabase as never, { workspaceId: context.workspaceId, serviceId, actorUserId: null });
        res = out.ok ? { ok: true } : { ok: false, error: { message: out.error } };
        break;
      }
    }
    if (!res.ok) note("failed", res.error?.message ?? "No se pudo hacer.");
  };
}



export const serviceActionNodes: Array<NodeDefinition<ServiceActionData>> = SERVICE_ACTION_TYPES.map((type) => ({
  needsContact: true,
  type,
  label: LABELS[type],
  aliases: [{ nodeType: "action", actionType: type }],
  execute: makeExecute(type),
}));

export { SERVICE_ACTION_LABELS } from "./service-action-detail";
