"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcSchema } from "@/lib/services/db";
import { issueCertificateCore, voidCertificateCore } from "@/lib/services/certificate-core";
import { loadModuleDesignExtensions } from "@/lib/designer/module-extensions";

/**
 * El certificado de un servicio desde su ficha (F67, F69). Emitir pide `certificates.issue`; anular,
 * `certificates.void`; volver a emitir, las dos. El servicio se busca con la SESIÓN (su RLS: quien no lo ve, no lo
 * toca) y del negocio de la sesión; recién después se escribe con el cliente de servicio.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result = { ok: true; code: string; existing?: boolean } | { ok: false; error: string };
const NOT_ALLOWED: Result = { ok: false, error: "No tenés permiso para hacer esto" };

async function visibleService(supabase: unknown, workspaceId: string, serviceId: string): Promise<boolean> {
  if (!UUID.test(serviceId)) return false;
  const { data } = await svcSchema(supabase).from("services").select("id").eq("id", serviceId).eq("workspace_id", workspaceId).maybeSingle();
  return !!data;
}

export async function issueCertificate(serviceId: string): Promise<Result> {
  const ctx = await getPermissionAction("certificates.issue");
  if (!ctx || !(await visibleService(ctx.supabase, ctx.workspace.id, serviceId))) return NOT_ALLOWED;
  loadModuleDesignExtensions();
  const res = await issueCertificateCore((await createServiceClient()) as never, { workspaceId: ctx.workspace.id, serviceId, actorUserId: ctx.user.id });
  revalidatePath(`/dashboard/clientes/s/${serviceId}`);
  return res.ok ? { ok: true, code: res.code, existing: res.existing } : { ok: false, error: res.error };
}

export async function voidCertificate(serviceId: string, reason: string): Promise<Result> {
  const ctx = await getPermissionAction("certificates.void");
  if (!ctx || !(await visibleService(ctx.supabase, ctx.workspace.id, serviceId))) return NOT_ALLOWED;
  if (!reason.trim()) return { ok: false, error: "Escribí el motivo" };
  const res = await voidCertificateCore((await createServiceClient()) as never, { workspaceId: ctx.workspace.id, serviceId, userId: ctx.user.id, reason: reason.trim() });
  revalidatePath(`/dashboard/clientes/s/${serviceId}`);
  return res.ok ? { ok: true, code: "" } : res;
}

/** Anula el vigente y emite uno nuevo con los datos de hoy. */
export async function reissueCertificate(serviceId: string, reason: string): Promise<Result> {
  const ctx = await getPermissionAction("certificates.void");
  if (!ctx || !ctx.can("certificates.issue") || !(await visibleService(ctx.supabase, ctx.workspace.id, serviceId))) return NOT_ALLOWED;
  if (!reason.trim()) return { ok: false, error: "Escribí el motivo" };
  loadModuleDesignExtensions();
  const db = (await createServiceClient()) as never;
  const voided = await voidCertificateCore(db, { workspaceId: ctx.workspace.id, serviceId, userId: ctx.user.id, reason: reason.trim() });
  if (!voided.ok) return voided;
  const res = await issueCertificateCore(db, { workspaceId: ctx.workspace.id, serviceId, actorUserId: ctx.user.id });
  revalidatePath(`/dashboard/clientes/s/${serviceId}`);
  return res.ok ? { ok: true, code: res.code } : { ok: false, error: res.error };
}
