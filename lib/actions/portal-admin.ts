"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcRpc, type SvcResult } from "@/lib/services/db";
import { loadPortalHost, portalUrl } from "@/lib/portal-admin/load";
import { sendTransactionalEmail } from "@/lib/email/send";
import { portalInviteEmail } from "@/lib/email/templates";
import { resolveBrand } from "@/lib/brand";

/**
 * Las acciones del portal desde SSA (bloque AC). Cada una pide su clave acá y la función de la base la vuelve a pedir
 * con la sesión y el alcance. El workspace sale de la sesión. Los tokens viajan una sola vez (de la base al email o
 * al navegador que abre la vista previa) y nunca se guardan ni se loguean: la base guarda solo la huella.
 */

const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const refreshService = (serviceId: string) => revalidatePath(`/dashboard/clientes/s/${serviceId}`);

// ─── Accesos (F40, services.access) ─────────────────────────────────────────

export async function grantExtraAccess(serviceId: string, input: { section: string; productId?: string | null; endsOn: string | null; reason: string }): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("services.access");
  if (!ctx || !UUID.test(serviceId) || (input.productId && !UUID.test(input.productId)) || (input.endsOn && !DATE.test(input.endsOn))) return NOT_ALLOWED;
  const res = await svcRpc<string>(ctx.supabase, "svc_access_grant_extra", {
    p_service_id: serviceId,
    p_section: input.section,
    p_product_id: input.productId ?? null,
    p_ends_on: input.endsOn,
    p_reason: input.reason,
  });
  if (res.ok) refreshService(serviceId);
  return res;
}

export async function extendAccess(serviceId: string, accessId: string, endsOn: string, reason: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.access");
  if (!ctx || !UUID.test(accessId) || !DATE.test(endsOn)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_access_extend", { p_access_id: accessId, p_ends_on: endsOn, p_reason: reason });
  if (res.ok) refreshService(serviceId);
  return res;
}

export async function revokeAccess(serviceId: string, accessId: string, reason: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.access");
  if (!ctx || !UUID.test(accessId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_access_revoke", { p_access_id: accessId, p_reason: reason });
  if (res.ok) refreshService(serviceId);
  return res;
}

export async function giveAccessNow(serviceId: string, section: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("services.access");
  if (!ctx || !UUID.test(serviceId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "svc_access_give_now", { p_service_id: serviceId, p_section: section });
  if (res.ok) refreshService(serviceId);
  return res;
}

// ─── Cuenta del portal (F41, portal.accounts) ───────────────────────────────

export type InviteOutcome = "sent" | "no_host" | "no_email" | "email_conflict" | "suspended" | "rate_limited" | "email_failed" | "email_not_configured";

/**
 * Invitar (o reenviar) al portal. Sin dirección del portal cargada no se genera nada. La base deja la huella de un
 * token nuevo (el anterior deja de valer) y devuelve el token una vez; acá se arma el link con la dirección del
 * portal y se manda por el Resend del negocio como email transaccional (sale aunque la persona se haya dado de baja
 * de marketing).
 */
export async function inviteToPortal(contactId: string): Promise<SvcResult<{ outcome: InviteOutcome; retryAfterSeconds?: number }>> {
  const ctx = await getPermissionAction("portal.accounts");
  if (!ctx || !UUID.test(contactId)) return NOT_ALLOWED;
  const service = await createServiceClient();
  const { host, welcome } = await loadPortalHost(service, ctx.workspace.id);
  if (!host) return { ok: true, data: { outcome: "no_host" } };
  const res = await svcRpc<{ status: string; token?: string; email?: string; account_id?: string; retry_after_seconds?: number }>(ctx.supabase, "portal_admin_invite", {
    p_workspace_id: ctx.workspace.id,
    p_contact_id: contactId,
  });
  if (!res.ok) return res;
  const d = res.data;
  if (d.status !== "ok" || !d.token || !d.email) {
    return { ok: true, data: { outcome: (d.status as InviteOutcome) ?? "email_failed", retryAfterSeconds: d.retry_after_seconds } };
  }
  const { data: contact } = await ctx.supabase.from("contacts").select("display_name").eq("id", contactId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  const content = portalInviteEmail({
    workspaceName: ctx.workspace.name,
    inviteUrl: portalUrl(host, `/entrar/invitacion/${d.token}`),
    studentName: (contact as { display_name?: string | null } | null)?.display_name ?? null,
    subject: welcome.invite_subject,
    body: welcome.invite_body,
    brand: resolveBrand(ctx.workspace),
  });
  const sent = await sendTransactionalEmail({
    workspaceId: ctx.workspace.id,
    to: d.email,
    subject: content.subject,
    html: content.html,
    kind: "portal_invite",
    relatedEntityType: "contact",
    relatedEntityId: contactId,
    contactId,
    createdBy: ctx.user.id,
    category: "transactional",
  });
  revalidatePath(`/dashboard/clientes/c/${contactId}`);
  if (!sent.ok) return { ok: true, data: { outcome: sent.reason === "not_configured" ? "email_not_configured" : "email_failed" } };
  return { ok: true, data: { outcome: "sent" } };
}

export async function suspendPortalAccount(contactId: string, accountId: string, reason: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("portal.accounts");
  if (!ctx || !UUID.test(accountId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "portal_admin_suspend_account", { p_account_id: accountId, p_reason: reason });
  if (res.ok) revalidatePath(`/dashboard/clientes/c/${contactId}`);
  return res;
}

export async function reactivatePortalAccount(contactId: string, accountId: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("portal.accounts");
  if (!ctx || !UUID.test(accountId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "portal_admin_reactivate_account", { p_account_id: accountId });
  if (res.ok) revalidatePath(`/dashboard/clientes/c/${contactId}`);
  return res;
}

// ─── «Ver como estudiante» (F42, portal.view_as) ────────────────────────────

/**
 * Crea el pase de 60 segundos y devuelve la URL para abrir en otra pestaña. Sin dirección del portal: `no_host`. Un
 * Member que no ve al cliente recibe el mismo error que si no existiera.
 */
export async function createPreviewPass(contactId: string): Promise<SvcResult<{ url: string | null }>> {
  const ctx = await getPermissionAction("portal.view_as");
  if (!ctx || !UUID.test(contactId)) return NOT_ALLOWED;
  const service = await createServiceClient();
  const { host } = await loadPortalHost(service, ctx.workspace.id);
  if (!host) return { ok: true, data: { url: null } };
  const res = await svcRpc<{ token: string }>(ctx.supabase, "portal_admin_create_preview_pass", { p_workspace_id: ctx.workspace.id, p_contact_id: contactId });
  if (!res.ok) return res;
  return { ok: true, data: { url: portalUrl(host, `/vista-previa/${res.data.token}`) } };
}

// ─── Portal › Programas y Ajustes del portal (F35, F43) ─────────────────────

type SaveStatus = { status: "ok" | "conflict" | "invalid"; rev?: number; problems?: string[]; current?: unknown };

/** Ajustes del portal (`portal.settings`). La base conserva `extensions` y rechaza una dirección repetida (AC010). */
export async function savePortalSettings(patch: Record<string, unknown>, rev: number): Promise<SvcResult<SaveStatus>> {
  const ctx = await getPermissionAction("portal.settings");
  if (!ctx) return NOT_ALLOWED;
  const clean = { ...patch };
  delete clean.extensions;
  const res = await svcRpc<SaveStatus>(ctx.supabase, "portal_admin_save_settings", { p_workspace_id: ctx.workspace.id, p_patch: clean, p_rev: rev });
  if (res.ok) revalidatePath("/dashboard/portal");
  return res;
}

/**
 * «+ Agregar programa»: prende el acceso al portal de las variantes elegidas (al menos una). Cada variante se guarda
 * con su revisión, por la misma función que Productos › variante › Portal.
 */
export async function addPortalProgram(productId: string, variantIds: string[]): Promise<SvcResult<{ saved: number }>> {
  const ctx = await getPermissionAction("portal.sections");
  if (!ctx || !UUID.test(productId) || variantIds.some((v) => !UUID.test(v))) return NOT_ALLOWED;
  if (variantIds.length === 0) return { ok: false, error: { code: "SV001", message: "Elegí al menos una variante con acceso al portal", detail: null } };
  const { data } = await ctx.supabase.from("product_variants").select("id, product_id, portal_settings, portal_settings_rev").eq("product_id", productId).in("id", variantIds);
  const rows = (data ?? []) as unknown as Array<{ id: string; product_id: string; portal_settings: Record<string, unknown> | null; portal_settings_rev: number }>;
  if (rows.length !== variantIds.length) return NOT_ALLOWED;
  let saved = 0;
  for (const v of rows) {
    const next = { v: 1, sections: [], ...(v.portal_settings ?? {}), enabled: true };
    const res = await svcRpc<SaveStatus>(ctx.supabase, "portal_admin_save_variant_portal", { p_variant_id: v.id, p_settings: next, p_rev: v.portal_settings_rev ?? 0 });
    if (!res.ok) return res;
    if (res.data.status !== "ok") return { ok: false, error: { code: "SV001", message: (res.data.problems ?? []).join(". ") || "Alguien cambió la variante mientras la editabas. Probá de nuevo.", detail: null } };
    saved++;
  }
  revalidatePath("/dashboard/portal");
  return { ok: true, data: { saved } };
}
