"use server";
// @plantilla-quitar(proyectos)

import { revalidatePath } from "next/cache";
import { getAnyPermissionAction, getPermissionAction } from "@/lib/auth/guards";
import { svcRpc, type SvcResult } from "@/lib/services/db";
import { createServiceClient } from "@/lib/supabase/server";
import { sendTransactionalEmail } from "@/lib/email/send";
import { portalReceiptRequestEmail } from "@/lib/email/templates";
import { resolveBrand } from "@/lib/brand";
import { formatCents } from "@/lib/projects/money";
import { projectsSettingsProblems } from "@/lib/projects/settings";

/**
 * La extensión de proyectos desde el panel (Corrida C, C2: F79–F81, F118, F120). Todo pasa por las funciones
 * `projects_admin_*` (00396), que vuelven a pedir el permiso con la sesión y que la extensión esté prendida.
 */

const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (message: string) => ({ ok: false as const, error: { code: "SV001", message, detail: null } });

export interface PaymentInput {
  title: string;
  description?: string;
  amount_cents: number;
  received_on: string;
  project_id?: string | null;
  before_program?: boolean;
}

/** Cargar un pago a nombre del estudiante (queda verificado: lo cargó el equipo). */
export async function addStudentPayment(serviceId: string, input: PaymentInput): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("student_revenue.manage");
  if (!ctx || !UUID.test(serviceId)) return NOT_ALLOWED;
  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) return bad("El monto tiene que ser mayor que cero");
  const res = await svcRpc<string>(ctx.supabase, "projects_admin_payment_add", { p_service_id: serviceId, p: input });
  if (res.ok) revalidatePath("/dashboard", "layout");
  return res;
}

export async function verifyStudentPayment(entryId: string, verified: boolean): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("student_revenue.manage");
  if (!ctx || !UUID.test(entryId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "projects_admin_payment_verify", { p_entry_id: entryId, p_verified: verified });
  if (res.ok) revalidatePath("/dashboard", "layout");
  return res;
}

/** Ajustar el total: la base crea un ajuste por la diferencia, con el motivo. Devuelve el total nuevo. */
export async function adjustStudentTotal(serviceId: string, targetCents: number, reason: string): Promise<SvcResult<number>> {
  const ctx = await getPermissionAction("student_revenue.manage");
  if (!ctx || !UUID.test(serviceId)) return NOT_ALLOWED;
  if (!Number.isInteger(targetCents) || targetCents < 0) return bad("El total no puede ser negativo");
  if (reason.trim().length < 3) return bad("Escribí el motivo del ajuste");
  const res = await svcRpc<number>(ctx.supabase, "projects_admin_adjust_total", { p_service_id: serviceId, p_target_cents: targetCents, p_reason: reason.trim() });
  if (res.ok) revalidatePath("/dashboard", "layout");
  return res;
}

/**
 * «Pedir comprobante» (F120): la base marca el pago y lo deja en audit_log; acá se manda el email transaccional por el
 * Resend del negocio. Sin cuenta del portal no hay email (el aviso igual aparece cuando entre). Devuelve si salió.
 */
export async function requestPaymentReceipt(entryId: string): Promise<SvcResult<{ emailed: boolean }>> {
  const ctx = await getPermissionAction("student_revenue.manage");
  if (!ctx || !UUID.test(entryId)) return NOT_ALLOWED;
  const res = await svcRpc<{ contact_id: string; title: string; amount_cents: number; received_on: string; email: string | null }>(ctx.supabase, "projects_admin_request_receipt", { p_entry_id: entryId });
  if (!res.ok) return res;
  const d = res.data;
  let emailed = false;
  if (d.email) {
    const service = await createServiceClient();
    const { data: ws } = await service.from("workspaces").select("portal_settings").eq("id", ctx.workspace.id).maybeSingle();
    const host = ((ws as { portal_settings?: { host?: string | null } } | null)?.portal_settings?.host ?? "").trim();
    const { data: contact } = await ctx.supabase.from("contacts").select("display_name").eq("id", d.contact_id).maybeSingle();
    const content = portalReceiptRequestEmail({
      brand: resolveBrand(ctx.workspace),
      workspaceName: ctx.workspace.name,
      studentName: (contact as { display_name?: string | null } | null)?.display_name ?? null,
      paymentTitle: d.title,
      amount: formatCents(d.amount_cents),
      receivedOn: d.received_on,
      url: host ? `https://${host}/` : null,
    });
    const sent = await sendTransactionalEmail({
      workspaceId: ctx.workspace.id,
      to: d.email,
      subject: content.subject,
      html: content.html,
      kind: "portal_receipt_request",
      relatedEntityType: "contact",
      relatedEntityId: d.contact_id,
      contactId: d.contact_id,
      createdBy: ctx.user.id,
      category: "transactional",
    });
    emailed = sent.ok;
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true, data: { emailed } };
}

export interface IdeaInput {
  title: string;
  description?: string;
  industry?: string;
  size: "small" | "medium" | "large";
  active?: boolean;
  all_programs?: boolean;
}

export async function saveProjectIdea(productId: string, ideaId: string | null, input: IdeaInput): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("projects.templates");
  if (!ctx || !UUID.test(productId) || (ideaId !== null && !UUID.test(ideaId))) return NOT_ALLOWED;
  const res = await svcRpc<string>(ctx.supabase, "projects_admin_save_idea", { p_idea_id: ideaId, p_product_id: productId, p: input });
  if (res.ok) revalidatePath(`/dashboard/portal/${productId}`);
  return res;
}

export type WorkbenchResult = { status: "ok"; rev: number; current: Record<string, unknown> } | { status: "invalid"; problems: string[] } | { status: "conflict"; rev: number };

/** Mesa de trabajo (F118): pasos y rangos. La base sube la versión de cada texto que cambia. */
export async function saveWorkbench(productId: string, patch: { steps?: unknown[]; budget_ranges?: unknown[] }, rev: number): Promise<SvcResult<WorkbenchResult>> {
  const ctx = await getPermissionAction("projects.templates");
  if (!ctx || !UUID.test(productId)) return NOT_ALLOWED;
  const problems = projectsSettingsProblems(patch);
  if (problems.length) return { ok: true, data: { status: "invalid", problems } };
  const res = await svcRpc<WorkbenchResult>(ctx.supabase, "projects_admin_save_workbench", { p_product_id: productId, p_patch: patch, p_rev: rev });
  if (res.ok) revalidatePath(`/dashboard/portal/${productId}`);
  return res;
}

/** El dato «Facturación como builder» de la ficha del cliente (F81). Vacío si no corresponde. */
export async function loadContactRevenue(contactId: string): Promise<{ total_cents: number; verified_cents: number } | null> {
  const ctx = await getAnyPermissionAction(["services.view"]);
  if (!ctx || !UUID.test(contactId)) return null;
  const res = await svcRpc<{ total_cents: number; verified_cents: number } | null>(ctx.supabase, "projects_admin_contact_revenue", { p_contact_id: contactId });
  return res.ok ? res.data : null;
}

export interface ServiceProjects {
  totals: { total_cents?: number; verified_cents?: number; pending_cents?: number; before_program_cents?: number; without_receipt?: number };
  projects: Array<{ id: string; kind: "real" | "practice" | "challenge"; title: string; status: string | null; client: { company?: string } | null; sold_cents: number | null; updated_at: string }>;
  payments: Array<{ id: string; kind: "payment" | "adjustment"; title: string; amount_cents: number; received_on: string; state: "verified" | "pending" | "no_receipt"; has_receipt: boolean; before_program: boolean; adjust_reason: string | null; entered_by_kind: "student" | "team" }>;
}

/** Ficha del servicio › Proyectos e ingresos (F79). null = la extensión está apagada o no corresponde. */
export async function loadServiceProjects(serviceId: string): Promise<{ data: ServiceProjects; canManage: boolean } | null> {
  const ctx = await getAnyPermissionAction(["services.view"]);
  if (!ctx || !UUID.test(serviceId)) return null;
  const on = ((ctx.workspace as { portal_settings?: { extensions?: { projects?: boolean } } | null }).portal_settings?.extensions?.projects ?? false) === true;
  if (!on) return null;
  const res = await svcRpc<ServiceProjects>(ctx.supabase, "projects_admin_service", { p_service_id: serviceId });
  return res.ok ? { data: res.data, canManage: ctx.can("student_revenue.manage") } : null;
}
