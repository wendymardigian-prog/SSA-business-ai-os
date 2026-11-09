"use server";
// @plantilla-quitar(ventas)

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { affRpc, NOT_ALLOWED, type AffResult, type SaveStatus } from "@/lib/affiliates/rpc";
import { normalizePrimaries, type ProductLinks } from "@/lib/affiliates/product-links";
import type { AffiliateSettings } from "@/lib/affiliates/assign";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { sanitizeSearch } from "@/lib/url-params";

/**
 * Las acciones de afiliados (bloque AF). Cada una pide su clave acá y la función de la base la vuelve a pedir con la
 * sesión (`has_permission`). El workspace sale siempre de la sesión. Nada escribe directo en las columnas de
 * afiliados: las guardas de la 00343 lo rechazan (AF010).
 */

export interface AffiliateRef {
  type: "user" | "contact";
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validRef = (r: AffiliateRef | null) => r === null || ((r.type === "user" || r.type === "contact") && UUID.test(r.id));

/** La tarjeta Links del producto (F70). Un principal inactivo o vencido se vacía antes de guardar, con su aviso. */
export async function saveProductLinks(productId: string, links: ProductLinks, rev: number): Promise<AffResult<SaveStatus<ProductLinks> & { notices?: string[] }>> {
  const ctx = await getPermissionAction("product_links.manage");
  if (!ctx) return NOT_ALLOWED;
  const today = new Date().toISOString().slice(0, 10);
  const { links: clean, notices } = normalizePrimaries(links, today);
  const res = await affRpc<SaveStatus<ProductLinks>>(ctx.supabase, "product_links_save", { p_product_id: productId, p_links: clean, p_rev: rev });
  if (res.ok && res.data.status === "ok") {
    revalidatePath(`/dashboard/settings/productos/${productId}`);
    revalidatePath("/dashboard/mis-links");
  }
  return res.ok ? { ok: true, data: { ...res.data, notices } } : res;
}

/** Afiliados › Reglas (F72). */
export async function saveAffiliateSettings(settings: AffiliateSettings, rev: number): Promise<AffResult<SaveStatus<AffiliateSettings>>> {
  const ctx = await getPermissionAction("affiliates.settings");
  if (!ctx) return NOT_ALLOWED;
  const res = await affRpc<SaveStatus<AffiliateSettings>>(ctx.supabase, "affiliate_settings_save", { p_workspace_id: ctx.workspace.id, p_settings: settings, p_rev: rev });
  if (res.ok && res.data.status === "ok") revalidatePath("/dashboard/afiliados", "layout"); // también las Reglas
  return res;
}

/** Mi código (F71): se crea la primera vez que la persona abre Mis links y no cambia nunca. */
export async function ensureMyAffiliateCode(): Promise<AffResult<string>> {
  const ctx = await getPermissionAction("affiliates.use");
  if (!ctx) return NOT_ALLOWED;
  const res = await affRpc<string>(ctx.supabase, "affiliate_ensure_code", { p_workspace_id: ctx.workspace.id, p_kind: "member", p_id: ctx.user.id });
  if (res.ok) revalidatePath("/dashboard/mis-links");
  return res;
}

/** Dar de alta un afiliado externo (F71): un contacto recibe su código. */
export async function makeContactAffiliate(contactId: string): Promise<AffResult<string>> {
  const ctx = await getPermissionAction("affiliates.external");
  if (!ctx || !UUID.test(contactId)) return NOT_ALLOWED;
  const res = await affRpc<string>(ctx.supabase, "affiliate_ensure_code", { p_workspace_id: ctx.workspace.id, p_kind: "contact", p_id: contactId });
  if (res.ok) {
    revalidatePath(`/dashboard/contacts/${contactId}`);
    revalidatePath("/dashboard/afiliados", "layout"); // también las Reglas
  }
  return res;
}

/** Asignar, cambiar o quitar el afiliado de un contacto (F104), con motivo. */
export async function setContactAffiliate(
  contactId: string,
  affiliate: AffiliateRef | null,
  input: { kind: "originated" | "influenced" | null; expiresAt: string | null; reason: string },
): Promise<AffResult<null>> {
  const ctx = await getPermissionAction("affiliates.assign");
  if (!ctx || !UUID.test(contactId) || !validRef(affiliate)) return NOT_ALLOWED;
  const res = await affRpc<null>(ctx.supabase, "affiliate_set_contact", {
    p_contact_id: contactId,
    p_affiliate: affiliate,
    p_kind: input.kind,
    p_expires_at: input.expiresAt,
    p_reason: input.reason,
  });
  if (res.ok) revalidatePath(`/dashboard/contacts/${contactId}`);
  return res;
}

/** Cambiar el afiliado de una venta ya cargada (F104), con motivo. Vale para los pagos que se cobren desde ahora. */
export async function setSaleAffiliate(saleId: string, affiliate: AffiliateRef | null, input: { kind: "originated" | "influenced" | null; reason: string }): Promise<AffResult<null>> {
  const ctx = await getPermissionAction("affiliates.assign");
  if (!ctx || !UUID.test(saleId) || !validRef(affiliate)) return NOT_ALLOWED;
  const res = await affRpc<null>(ctx.supabase, "affiliate_set_sale", { p_sale_id: saleId, p_affiliate: affiliate, p_kind: input.kind, p_reason: input.reason });
  if (res.ok) revalidatePath(`/dashboard/ventas/${saleId}`);
  return res;
}

/**
 * El afiliado elegido en el asistente de venta (F74): segundo paso después de `create_sale` (que no se toca). Lo escribe
 * el servidor, sin motivo, solo sobre una venta de ESTE negocio, cargada por esta persona y todavía sin afiliado.
 */
export async function setNewSaleAffiliate(saleId: string, affiliate: AffiliateRef, kind: "originated" | "influenced" | null): Promise<AffResult<null>> {
  const ctx = await getPermissionAction("sales.manage");
  if (!ctx || !UUID.test(saleId) || !validRef(affiliate)) return NOT_ALLOWED;
  const service = await createServiceClient();
  const { data: sale } = await service
    .from("sales")
    .select("id, workspace_id, created_by, affiliate_user_id, affiliate_contact_id")
    .eq("id", saleId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  const row = sale as { created_by: string | null; affiliate_user_id: string | null; affiliate_contact_id: string | null } | null;
  if (!row || row.created_by !== ctx.user.id || row.affiliate_user_id || row.affiliate_contact_id) return NOT_ALLOWED;
  const res = await affRpc<null>(service, "affiliate_set_sale", { p_sale_id: saleId, p_affiliate: affiliate, p_kind: kind ?? "influenced", p_reason: null });
  if (res.ok) revalidatePath(`/dashboard/ventas/${saleId}`);
  return res;
}

export interface AffiliateOption {
  type: "user" | "contact";
  id: string;
  name: string;
  code: string | null;
}

/** El buscador de contactos para dar de alta un afiliado externo: solo los que la persona ve (con su sesión). */
export async function searchContactsForAffiliate(query: string): Promise<Array<{ id: string; name: string; email: string | null }>> {
  const ctx = await getPermissionAction("affiliates.external");
  if (!ctx) return [];
  const q = sanitizeSearch(query, 60);
  if (q.length < 2) return [];
  const { data } = await ctx.supabase
    .from("contacts")
    .select("id, display_name, email")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order("display_name", { ascending: true })
    .limit(8);
  return (data ?? []).map((c) => ({ id: c.id, name: c.display_name || c.email || "Sin nombre", email: c.email ?? null }));
}

/**
 * El buscador de afiliados al asignar (F104) o al cargar una venta (F74): la gente del equipo y los contactos que ya
 * son afiliados. Se lee con el cliente de servicio después del permiso, siempre del negocio de la sesión.
 */
export async function searchAffiliates(query: string): Promise<AffiliateOption[]> {
  const ctx = (await getPermissionAction("affiliates.assign")) ?? (await getPermissionAction("sales.manage"));
  if (!ctx) return [];
  const q = sanitizeSearch(query, 60).toLowerCase();
  const service = await createServiceClient();
  const [{ data: members }, contacts] = await Promise.all([
    service.from("workspace_members").select("user_id, affiliate_code").eq("workspace_id", ctx.workspace.id),
    q.length < 2
      ? Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; affiliate_code: string | null }> })
      : service
          .from("contacts")
          .select("id, display_name, affiliate_code")
          .eq("workspace_id", ctx.workspace.id)
          .not("affiliate_code", "is", null)
          .is("deleted_at", null)
          .or(`display_name.ilike.%${q}%,affiliate_code.ilike.%${q}%`)
          .limit(8),
  ]);
  const team = await getWorkspaceMembers(ctx.workspace.id);
  const names = new Map(team.map((m) => [m.userId, m.name]));
  const fromTeam = ((members ?? []) as unknown as Array<{ user_id: string; affiliate_code: string | null }>)
    .map((m): AffiliateOption => ({ type: "user", id: m.user_id, name: names.get(m.user_id) ?? "Alguien del equipo", code: m.affiliate_code }))
    .filter((o) => !q || o.name.toLowerCase().includes(q) || (o.code ?? "").includes(q))
    .slice(0, 8);
  const fromContacts = ((contacts.data ?? []) as Array<{ id: string; display_name: string | null; affiliate_code: string | null }>).map(
    (c): AffiliateOption => ({ type: "contact", id: c.id, name: c.display_name || "Sin nombre", code: c.affiliate_code }),
  );
  return [...fromTeam, ...fromContacts];
}
