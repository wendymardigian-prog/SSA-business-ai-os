"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/shared/money";
import { snapshotText } from "@/lib/sales/sale-text";
import { sanitizeSearch } from "@/lib/url-params";
import type { MetaHit, PieceHit, SalePaymentOption, SalePaymentsResult, SaleTestOption } from "@/lib/commissions/rules-ui-lookup-types";

/**
 * Los buscadores del editor de reglas de comisión (F57 y F58). Piden `commissions.manage`.
 *
 *   - Las ventas y sus pagos se leen con la SESIÓN de quien prueba: la RLS decide cuáles ve (un Member con
 *     administración limitada no prueba con ventas ajenas).
 *   - Las piezas y el catálogo de Meta son nombres que el editor muestra en las condiciones: se leen con el cliente de
 *     servicio, DESPUÉS de comprobar el permiso y siempre filtrando por el workspace de la sesión.
 *
 * No escriben nada.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SALES_LIMIT = 8;

/** Las ventas para elegir una: por contacto (nombre, correo, teléfono) o, sin texto, las más recientes. */
export async function searchSalesForCommissionTest(query: string): Promise<SaleTestOption[]> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return [];
  const q = sanitizeSearch(typeof query === "string" ? query : "", 60);
  const ws = ctx.workspace.id;

  let contactIds: string[] | null = null;
  if (q.length >= 2) {
    const { data, error } = await ctx.supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", ws)
      .is("deleted_at", null)
      .or(`display_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,whatsapp_phone.ilike.%${q}%,instagram_username.ilike.%${q}%`)
      .limit(30);
    if (error) {
      console.error("[comisiones] no pude buscar contactos:", error.message);
      return [];
    }
    contactIds = ((data ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (contactIds.length === 0) return [];
  } else if (q.length > 0) {
    return [];
  }

  let sales = ctx.supabase
    .from("sales")
    .select("id, contact_id, status, final_amount, sale_date, product_snapshot")
    .eq("workspace_id", ws)
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(SALES_LIMIT);
  if (contactIds) sales = sales.in("contact_id", contactIds);
  const { data: saleRows, error } = await sales;
  if (error) {
    console.error("[comisiones] no pude buscar ventas:", error.message);
    return [];
  }
  const rows = (saleRows ?? []) as Array<{ id: string; contact_id: string; status: string; final_amount: unknown; sale_date: string; product_snapshot: unknown }>;
  if (rows.length === 0) return [];

  const { data: contacts } = await ctx.supabase
    .from("contacts")
    .select("id, display_name, email")
    .eq("workspace_id", ws)
    .in("id", [...new Set(rows.map((r) => r.contact_id))]);
  const names = new Map(((contacts ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>).map((c) => [c.id, c.display_name || c.email || "Sin nombre"]));

  return rows.map((r) => ({
    id: r.id,
    contactName: names.get(r.contact_id) ?? "Sin nombre",
    productText: snapshotText(r.product_snapshot),
    finalCents: toCents(r.final_amount),
    status: r.status,
    saleDate: r.sale_date,
  }));
}

/** Los pagos de una venta que se pueden probar (sin reembolsos ni anulados), en orden de fecha. */
export async function loadSalePaymentsForCommissionTest(saleId: string): Promise<SalePaymentsResult> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para administrar las comisiones" };
  if (typeof saleId !== "string" || !UUID_RE.test(saleId)) return { ok: false, error: "Esa venta no existe" };
  const ws = ctx.workspace.id;

  const { data: sale } = await ctx.supabase.from("sales").select("id").eq("id", saleId).eq("workspace_id", ws).maybeSingle();
  if (!sale) return { ok: false, error: "Esa venta no existe o no la podés ver" };

  const { data, error } = await ctx.supabase
    .from("payments")
    .select("id, type, status, amount, paid_on, due_date, payment_method, created_at")
    .eq("sale_id", saleId)
    .eq("workspace_id", ws)
    .limit(200);
  if (error) {
    console.error("[comisiones] no pude leer los pagos de la venta:", error.message);
    return { ok: false, error: "No pude leer los pagos de esa venta" };
  }
  const rows = ((data ?? []) as Array<{ id: string; type: string; status: string; amount: unknown; paid_on: string | null; due_date: string | null; payment_method: string | null; created_at: string }>)
    .filter((p) => p.type !== "refund" && p.status !== "cancelled")
    .sort((a, b) => (a.due_date ?? a.paid_on ?? "").localeCompare(b.due_date ?? b.paid_on ?? "") || a.created_at.localeCompare(b.created_at));
  const payments: SalePaymentOption[] = rows.map((p) => ({
    id: p.id,
    type: p.type,
    status: p.status,
    amountCents: toCents(p.amount),
    paidOn: p.paid_on,
    dueDate: p.due_date,
    method: p.payment_method,
  }));
  return { ok: true, payments };
}

/** Las piezas de contenido por título o código de atribución (las de la papelera no). */
export async function searchPiecesForCommissionRule(query: string): Promise<PieceHit[]> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return [];
  const q = sanitizeSearch(typeof query === "string" ? query : "", 60);
  if (q.length < 2) return [];
  const service = await createServiceClient();
  const { data, error } = await service
    .from("content_posts")
    .select("id, title, attribution_code")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .or(`title.ilike.%${q}%,attribution_code.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(8);
  if (error) {
    console.error("[comisiones] no pude buscar piezas:", error.message);
    return [];
  }
  return ((data ?? []) as Array<{ id: string; title: string; attribution_code: string | null }>).map((p) => ({ id: p.id, title: p.title, code: p.attribution_code ?? null }));
}

/** Campañas o anuncios del catálogo de Meta por nombre o por id. */
export async function searchMetaForCommissionRule(kind: "campaign" | "ad", query: string): Promise<MetaHit[]> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return [];
  if (kind !== "campaign" && kind !== "ad") return [];
  const q = sanitizeSearch(typeof query === "string" ? query : "", 60);
  if (q.length < 2) return [];
  const ws = ctx.workspace.id;
  const service = await createServiceClient();

  try {
    if (kind === "campaign") {
      const { data, error } = await service
        .from("meta_campaigns")
        .select("campaign_id, name")
        .eq("workspace_id", ws)
        .or(`name.ilike.%${q}%,campaign_id.ilike.%${q}%`)
        .order("created_time", { ascending: false })
        .limit(8);
      if (error) throw error;
      return ((data ?? []) as Array<{ campaign_id: string; name: string | null }>).map((c) => ({ id: c.campaign_id, name: c.name, hint: null }));
    }
    const { data, error } = await service
      .from("meta_ads")
      .select("ad_id, name, campaign_id")
      .eq("workspace_id", ws)
      .or(`name.ilike.%${q}%,ad_id.ilike.%${q}%`)
      .order("created_time", { ascending: false })
      .limit(8);
    if (error) throw error;
    const ads = (data ?? []) as Array<{ ad_id: string; name: string | null; campaign_id: string | null }>;
    const campaignIds = [...new Set(ads.map((a) => a.campaign_id).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (campaignIds.length > 0) {
      const { data: parents } = await service.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", ws).in("campaign_id", campaignIds);
      for (const row of (parents ?? []) as Array<{ campaign_id: string; name: string | null }>) if (row.name) names.set(row.campaign_id, row.name);
    }
    return ads.map((a) => ({ id: a.ad_id, name: a.name, hint: a.campaign_id ? (names.get(a.campaign_id) ?? null) : null }));
  } catch (err) {
    console.error("[comisiones] no pude buscar en el catálogo de Meta:", err instanceof Error ? err.message : "error desconocido");
    return [];
  }
}
