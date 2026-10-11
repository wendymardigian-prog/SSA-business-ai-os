"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { scheduleJob } from "@/lib/scheduler";
import { SIGNED_URL_SECONDS } from "@/lib/forms/files";
import { CONTRACTS_BUCKET } from "@/lib/forms/contract/storage";
import { emailJobKey } from "@/lib/forms/contract/email-retry";

/**
 * Ver el PDF de un contrato, reenviar la copia y regenerar el PDF (F28). Se pide
 * desde el detalle de una respuesta.
 *
 *  - Ver (`forms.view`): un link firmado de 60 SEGUNDOS, y solo si quien lo pide ve
 *    la respuesta. La firma se lee con el cliente de QUIEN PIDE: la RLS de
 *    `contract_signatures` (`can_see_form_submission`) decide. Sin ver la respuesta, no
 *    hay link.
 *  - Reenviar y regenerar (`forms.manage`): encolan un job con clave propia (con la
 *    marca de tiempo, así tocar dos veces en el mismo segundo no duplica) y quedan en el
 *    historial.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContractActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/** La firma de una respuesta, vista con la sesión de la persona (la RLS decide). */
async function visibleSignature(ctx: NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>, submissionId: string) {
  const { data } = await ctx.supabase
    .from("contract_signatures")
    .select("id, form_id, pdf_path, pdf_status, email_status")
    .eq("submission_id", submissionId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  return data;
}

export async function getContractPdfUrl(input: { submissionId: string }): Promise<ContractActionResult<{ url: string }>> {
  const ctx = await getPermissionAction("forms.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver formularios" };
  if (!UUID.test(input.submissionId)) return { ok: false, error: "Los datos no son válidos" };

  const signature = await visibleSignature(ctx, input.submissionId);
  if (!signature) return { ok: false, error: "No encontré esa firma" };
  if (signature.pdf_status !== "generated" || !signature.pdf_path) return { ok: false, error: "El PDF todavía no está listo" };

  const service = await createServiceClient();
  const { data, error } = await service.storage.from(CONTRACTS_BUCKET).createSignedUrl(signature.pdf_path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("[forms] getContractPdfUrl fallo");
    return { ok: false, error: "No pudimos abrir el PDF. Probá de nuevo." };
  }
  return { ok: true, url: data.signedUrl };
}

export async function resendContractCopy(input: { submissionId: string; now?: number }): Promise<ContractActionResult> {
  const ctx = await getPermissionAction("forms.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para administrar formularios" };
  if (!UUID.test(input.submissionId)) return { ok: false, error: "Los datos no son válidos" };

  const signature = await visibleSignature(ctx, input.submissionId);
  if (!signature) return { ok: false, error: "No encontré esa firma" };
  if (signature.pdf_status !== "generated") return { ok: false, error: "El PDF todavía no está listo: regeneralo primero." };

  const service = await createServiceClient();
  const { error } = await service
    .from("contract_signatures")
    .update({ email_status: "retrying", email_attempts: 0, email_next_retry_at: null, email_last_error: null })
    .eq("id", signature.id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[forms] resendContractCopy fallo, code=", error.code);
    return { ok: false, error: "No pudimos reenviar la copia. Probá de nuevo." };
  }

  try {
    await scheduleJob(service, "contract_email", { signatureId: signature.id, attempt: 0, manual: true }, new Date(), emailJobKey(signature.id, `manual:${input.now ?? Date.now()}`));
  } catch (e) {
    if ((e as { code?: string })?.code !== "23505") {
      console.error("[forms] resendContractCopy no pudo encolar");
      return { ok: false, error: "No pudimos encolar el envío. Probá de nuevo." };
    }
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "form_submission",
    entityId: input.submissionId,
    action: "contract.email_resent",
    performedBy: ctx.user.id,
  });
  revalidatePath(`/dashboard/formularios/${signature.form_id}/respuestas/${input.submissionId}`);
  return { ok: true };
}

export async function regenerateContractPdf(input: { submissionId: string; now?: number }): Promise<ContractActionResult> {
  const ctx = await getPermissionAction("forms.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para administrar formularios" };
  if (!UUID.test(input.submissionId)) return { ok: false, error: "Los datos no son válidos" };

  const signature = await visibleSignature(ctx, input.submissionId);
  if (!signature) return { ok: false, error: "No encontré esa firma" };
  if (signature.pdf_status !== "failed") return { ok: false, error: "El PDF no falló: no hace falta regenerarlo." };

  const service = await createServiceClient();
  const { error } = await service
    .from("contract_signatures")
    .update({ pdf_status: "pending", pdf_attempts: 0 })
    .eq("id", signature.id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[forms] regenerateContractPdf fallo, code=", error.code);
    return { ok: false, error: "No pudimos regenerar el PDF. Probá de nuevo." };
  }

  try {
    await scheduleJob(service, "contract_pdf", { signatureId: signature.id }, new Date(), `contract_pdf:${signature.id}:manual:${input.now ?? Date.now()}`);
  } catch (e) {
    if ((e as { code?: string })?.code !== "23505") {
      console.error("[forms] regenerateContractPdf no pudo encolar");
      return { ok: false, error: "No pudimos encolar la generación. Probá de nuevo." };
    }
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "form_submission",
    entityId: input.submissionId,
    action: "contract.pdf_regenerated",
    performedBy: ctx.user.id,
  });
  revalidatePath(`/dashboard/formularios/${signature.form_id}/respuestas/${input.submissionId}`);
  return { ok: true };
}
