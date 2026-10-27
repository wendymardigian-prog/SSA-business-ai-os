"use server";

import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import type { CommissionActionResult } from "@/lib/commissions/action-types";
import { parseCommissionFilters } from "@/lib/commissions/filters";
import { PAYOUT_MAX_IDS } from "@/lib/commissions/list-view";
import { paymentLabel, paymentPositions, type NumberablePayment } from "@/lib/commissions/row-labels";
import { loadSelectableCommissions } from "@/lib/commissions/screen-load";
import type { PaymentOption, SaleOption, SelectAllResult } from "@/lib/commissions/ui-action-types";
import { formatUsd } from "@/lib/finance/format";
import { formatCivilDate } from "@/lib/finance/view";
import { toCents } from "@/lib/shared/money";
import { snapshotText } from "@/lib/sales/sale-text";

/**
 * Acciones de apoyo de la pantalla de Comisiones (lecturas, no escriben nada): elegir todo el filtro para una
 * liquidación y buscar ventas y pagos para un ajuste. Cada una comprueba su permiso y lee con la SESIÓN, así que
 * la RLS sigue decidiendo qué ve cada quien. Lo que escribe (liquidar, ajustar) está en `commissions.ts`.
 */

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const UUID = z.uuid();
const NO_PAYOUT_PERMISSION = "Para generar un gasto de comisiones necesitás poder administrar las comisiones y los gastos";
const NO_PERMISSION = "No tenés permiso para administrar las comisiones";

/**
 * «Seleccionar todo el filtro»: las comisiones de TODO el filtro (no solo de la página) que se pueden pagar, hasta
 * 500 (el tope de una liquidación). `query` es el query string de la URL de la lista.
 */
export async function selectAllCommissionsOfFilter(query: string): Promise<CommissionActionResult<SelectAllResult>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx || !(await getPermissionAction("expenses.manage"))) return fail(NO_PAYOUT_PERMISSION);
  const filters = parseCommissionFilters(new URLSearchParams(typeof query === "string" ? query.slice(0, 2000) : ""));
  try {
    const result = await loadSelectableCommissions(ctx, filters, PAYOUT_MAX_IDS);
    if (!result) return fail("No pude leer las comisiones. Probá de nuevo.");
    return { ok: true, items: result.items, total: result.total, selectable: result.selectable, capped: result.selectable > PAYOUT_MAX_IDS, truncated: result.truncated };
  } catch (e) {
    console.error("[comisiones] no pude elegir todo el filtro:", e instanceof Error ? e.message : String(e));
    return fail("No pude leer las comisiones. Probá de nuevo.");
  }
}

/** Saca de un texto lo que rompería un filtro `ilike` de PostgREST (comodines y separadores). */
function safePattern(text: string): string {
  return text.replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** El buscador de ventas del ajuste: por nombre del contacto, o pegando el id de la venta. Hasta 15, las más nuevas. */
export async function searchSalesForAdjustment(query: string): Promise<CommissionActionResult<{ sales: SaleOption[] }>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  const text = typeof query === "string" ? query.trim() : "";
  if (text.length < 2) return { ok: true, sales: [] };
  const ws = ctx.workspace.id;

  let contactIds: string[] | null = null;
  if (!UUID.safeParse(text).success) {
    const pattern = safePattern(text);
    if (pattern.length < 2) return { ok: true, sales: [] };
    const { data, error } = await ctx.supabase.from("contacts").select("id").eq("workspace_id", ws).ilike("display_name", `%${pattern}%`).limit(20);
    if (error) {
      console.error("[comisiones] no pude buscar contactos:", error.message);
      return fail("No pude buscar. Probá de nuevo.");
    }
    contactIds = ((data ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (contactIds.length === 0) return { ok: true, sales: [] };
  }

  let q = ctx.supabase.from("sales").select("id, contact_id, product_snapshot, sale_date").eq("workspace_id", ws);
  q = contactIds ? q.in("contact_id", contactIds) : q.eq("id", text);
  const { data, error } = await q.order("sale_date", { ascending: false }).limit(15);
  if (error) {
    console.error("[comisiones] no pude buscar ventas:", error.message);
    return fail("No pude buscar. Probá de nuevo.");
  }
  const sales = (data ?? []) as unknown as Array<{ id: string; contact_id: string | null; product_snapshot: unknown; sale_date: string | null }>;
  const ids = [...new Set(sales.map((s) => s.contact_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: contacts } = await ctx.supabase.from("contacts").select("id, display_name").eq("workspace_id", ws).in("id", ids);
    for (const c of (contacts ?? []) as Array<{ id: string; display_name: string | null }>) names.set(c.id, c.display_name?.trim() || "Sin nombre");
  }
  return {
    ok: true,
    sales: sales.map((s) => ({
      id: s.id,
      label: `${s.contact_id ? names.get(s.contact_id) ?? "Contacto" : "Sin contacto"} · ${snapshotText(s.product_snapshot)} · ${formatCivilDate(s.sale_date)}`,
    })),
  };
}

/** Los pagos de una venta, para elegir a cuál va el ajuste (los anulados no). */
export async function listPaymentsForAdjustment(saleId: string): Promise<CommissionActionResult<{ payments: PaymentOption[] }>> {
  const ctx = await getPermissionAction("commissions.manage");
  if (!ctx) return fail(NO_PERMISSION);
  if (!UUID.safeParse(saleId).success) return fail("Esa venta no existe");
  const { data, error } = await ctx.supabase
    .from("payments")
    .select("id, sale_id, type, status, amount, paid_on, due_date, original_due_date, created_at")
    .eq("workspace_id", ctx.workspace.id)
    .eq("sale_id", saleId)
    .limit(200);
  if (error) {
    console.error("[comisiones] no pude leer los pagos de la venta:", error.message);
    return fail("No pude leer los pagos. Probá de nuevo.");
  }
  const rows = (data ?? []) as unknown as Array<NumberablePayment & { amount: unknown; paid_on: string | null }>;
  const positions = paymentPositions(rows);
  const sorted = [...rows]
    .filter((p) => p.status !== "cancelled")
    .sort((a, b) => (a.original_due_date ?? a.due_date ?? "9999").localeCompare(b.original_due_date ?? b.due_date ?? "9999") || a.created_at.localeCompare(b.created_at));
  return {
    ok: true,
    payments: sorted.map((p) => {
      const pos = positions.get(p.id);
      const when = p.paid_on ?? p.due_date;
      return { id: p.id, label: `${paymentLabel({ type: p.type, number: pos?.number ?? null, total: pos?.total ?? 0 })} · ${formatUsd(toCents(p.amount))}${when ? ` · ${formatCivilDate(when)}` : ""}` };
    }),
  };
}
