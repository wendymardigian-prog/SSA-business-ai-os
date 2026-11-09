// @plantilla-quitar(servicios)
/**
 * Emitir, anular y volver a emitir el certificado de un servicio (F67-F69), y lo que pasa cuando el Diseñador termina
 * de generarlo (F68). Recibe el cliente de SERVICIO: quien llama ya comprobó el permiso y saca el negocio de la sesión
 * (o es el sistema: la cola, una automatización). Nunca lanza: devuelve el resultado en español.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createGeneration, VALID_STATUSES } from "@/lib/designer/generate-core";
import { voidDesignCore } from "@/lib/designer/publishing";
import type { GeneratedDesign } from "@/lib/designer/extensions";
import { svcRpc, svcSchema } from "@/lib/services/db";
import { canIssueFor, certificateState, isServiceSubject, serviceSubjectRef, SERVICE_SUBJECT_MODULE, type CertificateDesign } from "@/lib/services/certificate";

type Db = SupabaseClient<Database>;

export type CertificateResult = { ok: true; designId: string; code: string; existing: boolean } | { ok: false; code: string; error: string };

const fail = (code: string, error: string) => ({ ok: false as const, code, error });

interface ServiceRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  status: string;
  product_snapshot: { product_name?: string } | null;
}

async function loadService(db: Db, workspaceId: string, serviceId: string): Promise<ServiceRow | null> {
  const { data } = await svcSchema(db).from("services").select("id, workspace_id, contact_id, status, product_snapshot").eq("id", serviceId).eq("workspace_id", workspaceId).maybeSingle();
  return (data as ServiceRow | null) ?? null;
}

/** La plantilla del paso Certificado del camino del servicio (el pendiente primero). */
async function certificateTemplate(db: Db, serviceId: string): Promise<string | null> {
  const { data } = await svcSchema(db).from("service_items").select("ref, status").eq("service_id", serviceId).eq("kind", "certificate").eq("is_recurring_template", false);
  const rows = ((data ?? []) as Array<{ ref: { template_id?: string } | null; status: string }>).sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
  return rows.find((r) => typeof r.ref?.template_id === "string")?.ref?.template_id ?? null;
}

/** Los certificados de un servicio (las generaciones con el servicio como sujeto y una plantilla de certificado). */
export async function serviceCertificates(db: Db, workspaceId: string, serviceId: string): Promise<CertificateDesign[]> {
  const { data } = await db
    .from("designs")
    .select("id, code, status, created_at, template_id, design_templates!inner(doc_type)")
    .eq("workspace_id", workspaceId)
    .eq("subject_ref->>module" as never, SERVICE_SUBJECT_MODULE as never)
    .eq("subject_ref->>id" as never, serviceId as never)
    .eq("design_templates.doc_type" as never, "certificado" as never)
    .order("created_at", { ascending: false })
    .limit(20);
  return ((data ?? []) as unknown as CertificateDesign[]).map(({ id, code, status, created_at }) => ({ id, code, status, created_at }));
}

/**
 * Emite el certificado del servicio con la plantilla de su paso Certificado. Uno vigente por servicio: si ya hay uno
 * válido, devuelve ese. Un servicio cancelado no emite (CE001).
 */
export async function issueCertificateCore(
  db: Db,
  input: { workspaceId: string; serviceId: string; actorUserId: string | null; templateId?: string | null },
): Promise<CertificateResult> {
  try {
    const s = await loadService(db, input.workspaceId, input.serviceId);
    if (!s) return fail("SV002", "No existe el servicio");
    if (!canIssueFor(s.status)) return fail("CE001", "Un servicio cancelado no puede emitir el certificado");
    const templateId = input.templateId ?? (await certificateTemplate(db, s.id));
    if (!templateId) return fail("CE002", "El camino de este servicio no tiene un paso Certificado con su plantilla");
    const { data: tpl } = await db.from("design_templates").select("id, doc_type, archived_at").eq("id", templateId).eq("workspace_id", s.workspace_id).maybeSingle();
    if (!tpl || (tpl as { doc_type: string | null }).doc_type !== "certificado") return fail("CE002", "La plantilla no es de un certificado de este negocio");
    if ((tpl as { archived_at: string | null }).archived_at) return fail("CE002", "La plantilla del certificado está archivada");
    const { current } = certificateState(await serviceCertificates(db, s.workspace_id, s.id));
    if (current) return { ok: true, designId: current.id, code: current.code, existing: true };
    const res = await createGeneration(db, {
      workspaceId: s.workspace_id,
      templateId,
      contactId: s.contact_id,
      subjectRef: serviceSubjectRef(s.id, s.product_snapshot?.product_name ?? "Servicio"),
      overrides: {},
      policy: "template_default",
      publish: true,
      source: "module",
      sourceRef: { kind: "module", module: "servicios", id: s.id },
      replaceExisting: false,
      actorUserId: input.actorUserId,
    });
    if (res.ok) return { ok: true, designId: res.designId, code: res.code, existing: false };
    if (res.reason === "existing") return { ok: true, designId: res.existing.designId, code: res.existing.code, existing: true };
    return fail("CE003", res.error);
  } catch (error) {
    console.error("[servicios] emitir el certificado falló:", error instanceof Error ? error.message : "error");
    return fail("CE003", "No se pudo emitir el certificado. Probá de nuevo.");
  }
}

/** Anula el certificado vigente del servicio (con la función del Diseñador; la verificación pasa a «Anulado»). */
export async function voidCertificateCore(db: Db, input: { workspaceId: string; serviceId: string; userId: string | null; reason: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { current } = certificateState(await serviceCertificates(db, input.workspaceId, input.serviceId));
  if (!current) return { ok: false, error: "El servicio no tiene un certificado vigente" };
  const r = await voidDesignCore(db, { workspaceId: input.workspaceId, userId: input.userId }, { designId: current.id, reason: input.reason });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * F68: cuando el Diseñador termina una generación de una plantilla de tipo Certificado con un servicio como sujeto,
 * completa el paso Certificado pendiente de ese servicio y emite `certificate_issued`. Vale venga de donde venga (el
 * paso, la ficha o una automatización). Si falla, el diseño queda igual y el error va al historial.
 */
export async function handleCertificateGenerated(db: Db, design: GeneratedDesign): Promise<void> {
  if (!isServiceSubject(design.subjectRef)) return;
  const serviceId = design.subjectRef.id;
  try {
    const { data: tpl } = await db.from("design_templates").select("doc_type").eq("id", design.templateId).eq("workspace_id", design.workspaceId).maybeSingle();
    if ((tpl as { doc_type: string | null } | null)?.doc_type !== "certificado") return;
    const s = await loadService(db, design.workspaceId, serviceId);
    if (!s) return;
    const { data: items } = await svcSchema(db)
      .from("service_items")
      .select("id")
      .eq("service_id", s.id)
      .eq("kind", "certificate")
      .eq("status", "pending")
      .eq("is_recurring_template", false)
      .limit(1);
    const item = (items as Array<{ id: string }> | null)?.[0];
    if (item) {
      const r = await svcRpc(db, "svc_mark_item", { p_item_id: item.id, p_source: "certificate", p_by_kind: "system", p_by: null });
      if (!r.ok) throw new Error(r.error.message);
    }
    const e = await svcRpc(db, "emit_service", { p_service_id: s.id, p_event: "certificate_issued", p_extra: { design_id: design.designId, code: design.code } });
    if (!e.ok) throw new Error(e.error.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    console.error("[servicios] completar el paso Certificado falló:", message);
    await db
      .from("audit_log")
      .insert({ workspace_id: design.workspaceId, entity_type: "service", entity_id: serviceId, action: "svc.hook_failed", changes: { hook: "certificate_generated", design_id: design.designId, error: message.slice(0, 300) }, actor_type: "system" } as never)
      .then(() => undefined, () => undefined);
  }
}

export { VALID_STATUSES };
