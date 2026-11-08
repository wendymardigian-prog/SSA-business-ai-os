// @plantilla-quitar(servicios)
/**
 * Lecturas de lo del estudiante. El esquema `app_servicio_portal` está CERRADO (no se expone por la API, F34): se lee
 * solo con funciones de `app_servicio` que miran el permiso y el alcance con la sesión de quien pide
 * (`portal_admin_service_accesses`, `portal_admin_account`). Nunca vuelven huellas ni secretos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { svcRpc } from "@/lib/services/db";

type Db = SupabaseClient<any, any, any>;

export interface AccessListRow {
  id: string;
  section: string;
  productId: string;
  startsAt: string;
  endsAt: string | null;
  untilType: string;
  source: string;
  reason: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  suspendedOverdueAt: string | null;
  suspendedPauseAt: string | null;
}

export async function loadServiceAccesses(supabase: Db, serviceId: string): Promise<AccessListRow[]> {
  const res = await svcRpc<Array<Record<string, unknown>>>(supabase, "portal_admin_service_accesses", { p_service_id: serviceId });
  if (!res.ok) {
    console.error("[portal] no pude leer los accesos:", res.error.code ?? "?");
    return [];
  }
  return (res.data ?? []).map((r) => ({
    id: r.id as string,
    section: r.section as string,
    productId: r.product_id as string,
    startsAt: r.starts_at as string,
    endsAt: (r.ends_at as string | null) ?? null,
    untilType: r.until_type as string,
    source: r.source as string,
    reason: (r.reason as string | null) ?? null,
    revokedAt: (r.revoked_at as string | null) ?? null,
    revokeReason: (r.revoke_reason as string | null) ?? null,
    suspendedOverdueAt: (r.suspended_overdue_at as string | null) ?? null,
    suspendedPauseAt: (r.suspended_pause_at as string | null) ?? null,
  }));
}

export interface PortalAccountView {
  id: string;
  status: "invited" | "active" | "suspended";
  inviteSentAt: string | null;
  inviteExpiresAt: string | null;
  lastLoginAt: string | null;
  suspendedReason: string | null;
}

export async function loadPortalAccount(supabase: Db, workspaceId: string, contactId: string): Promise<PortalAccountView | null> {
  const res = await svcRpc<Record<string, unknown> | null>(supabase, "portal_admin_account", { p_workspace_id: workspaceId, p_contact_id: contactId });
  const r = res.ok ? res.data : null;
  if (!r) return null;
  return {
    id: r.id as string,
    status: r.status as PortalAccountView["status"],
    inviteSentAt: (r.invite_sent_at as string | null) ?? null,
    inviteExpiresAt: (r.invite_expires_at as string | null) ?? null,
    lastLoginAt: (r.last_login_at as string | null) ?? null,
    suspendedReason: (r.suspended_reason as string | null) ?? null,
  };
}

/** La dirección del portal del negocio (`workspaces.portal_settings.host`), o null si no está cargada. */
export async function loadPortalHost(service: Db, workspaceId: string): Promise<{ host: string | null; welcome: { invite_subject?: string; invite_body?: string } }> {
  const { data } = await service.from("workspaces").select("portal_settings").eq("id", workspaceId).maybeSingle();
  const ps = ((data as { portal_settings?: Record<string, unknown> } | null)?.portal_settings ?? {}) as { host?: string; welcome?: { invite_subject?: string; invite_body?: string } };
  const host = typeof ps.host === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(ps.host) ? ps.host.toLowerCase() : null;
  return { host, welcome: ps.welcome ?? {} };
}

/** Los links del portal salen SIEMPRE de su dirección cargada (decisión 437), nunca del dominio de la app. */
export function portalUrl(host: string, path: string): string {
  return `https://${host}${path.startsWith("/") ? path : `/${path}`}`;
}
