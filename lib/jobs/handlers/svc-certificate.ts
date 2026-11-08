// @plantilla-quitar(servicios)
/**
 * El job `svc_certificate_issue` (Servicios A1, F67): emite el certificado de UN servicio cuando llega a su paso
 * Certificado con «Emitirlo solo» (lo encola la base, S16). Uno vigente por servicio: repetirlo devuelve el existente.
 *
 * NO lanza: un servicio cancelado, sin plantilla o con la plantilla archivada queda anotado en el historial y el
 * paso se emite a mano desde la ficha. El render lo hace el Diseñador y, al quedar listo, completa el paso (F68).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { issueCertificateCore } from "@/lib/services/certificate-core";
import { loadModuleDesignExtensions } from "@/lib/designer/module-extensions";
import type { Database } from "@/lib/types/database";

export const SVC_CERTIFICATE_ISSUE_JOB = "svc_certificate_issue";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function runSvcCertificateIssue({ supabase, job }: JobContext): Promise<void> {
  const p = (job.payload ?? {}) as { service_id?: unknown; workspace_id?: unknown };
  if (!isUuid(p.service_id) || !isUuid(p.workspace_id)) return;
  loadModuleDesignExtensions();
  const res = await issueCertificateCore(supabase as SupabaseClient<Database>, { workspaceId: p.workspace_id, serviceId: p.service_id, actorUserId: null });
  if (res.ok) return;
  await (supabase as SupabaseClient<Database>)
    .from("audit_log")
    .insert({ workspace_id: p.workspace_id, entity_type: "service", entity_id: p.service_id, action: "svc.certificate_not_issued", changes: { code: res.code, reason: res.error }, actor_type: "system" } as never)
    .then(() => undefined, () => undefined);
}

export function registerSvcCertificateHandler(): void {
  registerJobHandler(SVC_CERTIFICATE_ISSUE_JOB, runSvcCertificateIssue);
}
