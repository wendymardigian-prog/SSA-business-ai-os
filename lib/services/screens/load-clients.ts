// @plantilla-quitar(servicios)
/**
 * Clientes › pestaña Clientes (Servicios A2, F130.1): una lectura de los servicios que la persona ve (la RLS decide) y,
 * en tandas, sus contactos, lo cobrado y el resumen del portal. La agregacion por contacto es pura
 * (`buildClientRows`): ordenar, agrupar y filtrar pasan en el navegador.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { svcSchema } from "../db";
import { buildClientRows, type ClientRow, type ClientServiceInput } from "./clients-list";
import { contactNames, loadPortalSummary, portalProducts } from "./load-services";
import type { Light, ServiceStatus } from "./list";

type Db = SupabaseClient<any, any, any>;

/** Hasta cuantos servicios se leen para armar la lista (despues, se avisa que hay mas). */
export const CLIENTS_SERVICE_LIMIT = 2000;

export async function loadClientsList(supabase: Db, service: Db, workspaceId: string, memberNames: Map<string, string>): Promise<{ rows: ClientRow[]; truncated: boolean }> {
  const { data, error } = await svcSchema(supabase)
    .from("services")
    .select("contact_id, product_id, status, light, progress_pct, owner_user_id, sale_id")
    .eq("workspace_id", workspaceId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(CLIENTS_SERVICE_LIMIT + 1);
  if (error) console.error("[clientes] no pude leer los servicios:", error.message);
  const all = (data ?? []) as Array<{ contact_id: string; product_id: string; status: ServiceStatus; light: Light | null; progress_pct: number | string | null; owner_user_id: string | null; sale_id: string | null }>;
  const truncated = all.length > CLIENTS_SERVICE_LIMIT;
  const svc = all.slice(0, CLIENTS_SERVICE_LIMIT);
  const contactIds = [...new Set(svc.map((s) => s.contact_id))];
  const withPortal = await portalProducts(service, workspaceId, svc.map((s) => s.product_id));

  // Lo cobrado: los pagos cobrados de sus ventas, leidos con la sesion (quien no ve pagos no ve el total: queda "—").
  const saleToContact = new Map(svc.filter((s) => s.sale_id).map((s) => [s.sale_id as string, s.contact_id]));
  const paidCents = new Map<string, number>();
  const saleIds = [...saleToContact.keys()];
  for (let i = 0; i < saleIds.length; i += 300) {
    const { data: pays } = await supabase.from("payments").select("sale_id, amount").in("sale_id", saleIds.slice(i, i + 300)).eq("status", "paid");
    for (const p of (pays ?? []) as Array<{ sale_id: string; amount: number | string }>) {
      const c = saleToContact.get(p.sale_id);
      if (c) paidCents.set(c, (paidCents.get(c) ?? 0) + Math.round((Number(p.amount) || 0) * 100));
    }
  }
  for (const s of svc) if (s.sale_id && !paidCents.has(s.contact_id)) paidCents.set(s.contact_id, 0);

  const [names, summary] = await Promise.all([
    contactNames(supabase, contactIds),
    withPortal.size ? loadPortalSummary(supabase, [...new Set(svc.filter((s) => withPortal.has(s.product_id)).map((s) => s.contact_id))]) : Promise.resolve(new Map()),
  ]);
  const services: ClientServiceInput[] = svc.map((s) => ({
    contactId: s.contact_id,
    status: s.status,
    light: s.light,
    progressPct: Number(s.progress_pct) || 0,
    ownerName: s.owner_user_id ? memberNames.get(s.owner_user_id) ?? "Ya no está en el equipo" : null,
    hasPortal: withPortal.has(s.product_id),
  }));
  const portal = new Map([...summary.values()].map((r) => [r.contact_id, { accountStatus: r.account_status, lastLoginAt: r.last_login_at, pendingReviews: Number(r.pending_reviews) || 0 }]));
  return { rows: buildClientRows({ services, names, portal, paidCents, nowIso: new Date().toISOString() }), truncated };
}
