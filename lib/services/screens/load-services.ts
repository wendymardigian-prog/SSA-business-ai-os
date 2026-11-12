// @plantilla-quitar(servicios)
/**
 * Lecturas de Clientes (F26-F29). Con el cliente del USUARIO: la RLS (`can_see_service`) decide qué servicios ve.
 * Se lee directo de las tablas (sin vistas: ver PENDIENTE) y en tandas: una página de servicios, después sus
 * contactos, fases y responsables en UNA consulta cada uno, nunca fila por fila.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { svcRpc, svcSchema } from "../db";
import { PAGE_SIZE, type Light, type QuickFilter, type ServiceFilters, type ServiceListItem, type ServiceStatus } from "./list";

type Db = SupabaseClient<any, any, any>;

interface ServiceRow {
  id: string;
  contact_id: string;
  product_id: string;
  product_variant_id: string | null;
  owner_user_id: string | null;
  status: ServiceStatus;
  light: Light | null;
  light_reason: string | null;
  starts_on: string | null;
  ends_on: string | null;
  progress_pct: number | string | null;
  product_snapshot: { product_name?: string; variant_name?: string } | null;
  flags: Record<string, unknown> | null;
  sale_id: string | null;
  created_at: string;
}

const COLS = "id, contact_id, product_id, product_variant_id, owner_user_id, status, light, light_reason, starts_on, ends_on, progress_pct, product_snapshot, flags, sale_id, created_at";

export async function contactNames(supabase: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await supabase.from("contacts").select("id, display_name").in("id", [...new Set(ids)]);
  for (const c of (data ?? []) as Array<{ id: string; display_name: string | null }>) out.set(c.id, c.display_name ?? "Sin nombre");
  return out;
}

export async function currentPhases(supabase: Db, serviceIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (serviceIds.length === 0) return out;
  const { data } = await svcSchema(supabase).from("service_phases").select("service_id, name").in("service_id", serviceIds).eq("status", "in_progress");
  for (const p of (data ?? []) as Array<{ service_id: string; name: string }>) out.set(p.service_id, p.name);
  return out;
}

export interface ServicesPage {
  items: ServiceListItem[];
  total: number;
  /** Servicios con responsable dado de baja o a nombre del respaldo (el aviso de arriba). */
  departed: number;
  /** Cuantos servicios hay con cada filtro rapido (sin la busqueda). Las del portal, solo si algun producto lo tiene. */
  counts: Partial<Record<QuickFilter, number>>;
  /** Algun producto con servicios tiene portal: si no, el filtro rapido no ofrece lo del portal. */
  anyPortal: boolean;
}

export interface PortalSummaryRow {
  contact_id: string;
  account_status: string | null;
  last_login_at: string | null;
  invite_sent_at: string | null;
  pending_reviews: number;
  access_expiring_on: string | null;
}

/**
 * El resumen del portal de varios contactos (00361, `contacts_portal_summary`): cuenta, ultimo ingreso, entregas por
 * revisar y acceso por vencer. La funcion mira el alcance con la sesion; de a 500 por llamada.
 */
export async function loadPortalSummary(supabase: Db, contactIds: string[]): Promise<Map<string, PortalSummaryRow>> {
  const out = new Map<string, PortalSummaryRow>();
  const ids = [...new Set(contactIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const res = await svcRpc<PortalSummaryRow[]>(supabase, "contacts_portal_summary", { p_contact_ids: ids.slice(i, i + 500) });
    if (!res.ok) {
      console.error("[servicios] no pude leer el resumen del portal:", res.error.code ?? "?");
      continue;
    }
    for (const r of res.data ?? []) out.set(r.contact_id, r);
  }
  return out;
}

/** Los productos con portal prendido, leidos con el cliente de servicio filtrando por el negocio de la sesion. */
export async function portalProducts(service: Db, workspaceId: string, productIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Set();
  const { data } = await service.from("products").select("id, portal_enabled").eq("workspace_id", workspaceId).in("id", ids);
  return new Set(((data ?? []) as Array<{ id: string; portal_enabled: boolean | null }>).filter((p) => p.portal_enabled).map((p) => p.id));
}

const RUNNING_STATUSES = ["active", "paused", "pending_confirmation"];

export async function loadServicesPage(supabase: Db, workspaceId: string, f: ServiceFilters, memberNames: Map<string, string>, service: Db = supabase): Promise<ServicesPage> {
  // Lo del portal (entregas por revisar y accesos por vencer) se mira sobre los servicios en curso que ve la persona.
  const { data: running } = await svcSchema(supabase).from("services").select("contact_id, product_id").eq("workspace_id", workspaceId).in("status", RUNNING_STATUSES).limit(2000);
  const runningRows = (running ?? []) as Array<{ contact_id: string; product_id: string }>;
  const withPortal = await portalProducts(service, workspaceId, runningRows.map((r) => r.product_id));
  const anyPortal = withPortal.size > 0;
  const summary = anyPortal ? await loadPortalSummary(supabase, runningRows.filter((r) => withPortal.has(r.product_id)).map((r) => r.contact_id)) : new Map<string, PortalSummaryRow>();
  const reviewContacts = new Set([...summary.values()].filter((r) => Number(r.pending_reviews) > 0).map((r) => r.contact_id));
  const expiringContacts = new Set([...summary.values()].filter((r) => !!r.access_expiring_on).map((r) => r.contact_id));
  const countIn = (set: Set<string>) => runningRows.filter((r) => withPortal.has(r.product_id) && set.has(r.contact_id)).length;

  const head = () => svcSchema(supabase).from("services").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "cancelled");
  const [allC, redC, yellowC, pendingC] = await Promise.all([head(), head().eq("light", "red"), head().eq("light", "yellow"), head().eq("status", "pending_confirmation")]);
  const counts: Partial<Record<QuickFilter, number>> = { all: allC.count ?? 0, red: redC.count ?? 0, yellow: yellowC.count ?? 0, pending: pendingC.count ?? 0 };
  if (anyPortal) {
    counts.expiring = countIn(expiringContacts);
    counts.reviews = countIn(reviewContacts);
  }

  let contactIds: string[] | null = null;
  if (f.q.trim()) {
    const { data } = await supabase.from("contacts").select("id").eq("workspace_id", workspaceId).ilike("display_name", `%${f.q.trim().replace(/[%_]/g, "")}%`).limit(200);
    contactIds = ((data ?? []) as Array<{ id: string }>).map((c) => c.id);
  }
  if (f.quick === "expiring" || f.quick === "reviews") {
    const set = f.quick === "expiring" ? expiringContacts : reviewContacts;
    contactIds = contactIds ? contactIds.filter((id) => set.has(id)) : [...set];
  }
  if (contactIds && contactIds.length === 0) return { items: [], total: 0, departed: 0, counts, anyPortal };

  let q = svcSchema(supabase).from("services").select(COLS, { count: "exact" }).eq("workspace_id", workspaceId).neq("status", "cancelled");
  if (f.quick === "red") q = q.eq("light", "red");
  if (f.quick === "yellow") q = q.eq("light", "yellow");
  if (f.quick === "pending") q = q.eq("status", "pending_confirmation");
  if (f.quick === "expiring" || f.quick === "reviews") q = q.in("status", RUNNING_STATUSES).in("product_id", [...withPortal]);
  if (f.owner) q = q.eq("owner_user_id", f.owner);
  if (contactIds) q = q.in("contact_id", contactIds);
  if (f.departedOnly) q = q.contains("flags", { owner_departed: true });
  const from = (f.page - 1) * PAGE_SIZE;
  const { data, count, error } = await q.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (error) console.error("[servicios] no pude leer los servicios:", error.message);
  const rows = (data ?? []) as ServiceRow[];

  const [names, phases, departedRes] = await Promise.all([
    contactNames(supabase, rows.map((r) => r.contact_id)),
    currentPhases(supabase, rows.map((r) => r.id)),
    svcSchema(supabase).from("services").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("status", ["active", "paused", "pending_confirmation"]).contains("flags", { owner_departed: true }),
  ]);
  // El portal de las filas que no estaban en el resumen (por ejemplo, servicios completados de un producto con portal).
  const pageWithPortal = await portalProducts(service, workspaceId, rows.map((r) => r.product_id));
  const missing = rows.filter((r) => pageWithPortal.has(r.product_id) && !summary.has(r.contact_id)).map((r) => r.contact_id);
  if (missing.length) for (const [k, v] of await loadPortalSummary(supabase, missing)) summary.set(k, v);

  return {
    total: count ?? rows.length,
    departed: departedRes.count ?? 0,
    counts,
    anyPortal,
    items: rows.map((r) => {
      const p = pageWithPortal.has(r.product_id) ? summary.get(r.contact_id) : undefined;
      return {
        id: r.id,
        contactId: r.contact_id,
        contactName: names.get(r.contact_id) ?? "Sin nombre",
        productName: r.product_snapshot?.product_name ?? "",
        variantName: r.product_snapshot?.variant_name ?? "",
        ownerName: r.owner_user_id ? memberNames.get(r.owner_user_id) ?? "Ya no está en el equipo" : null,
        status: r.status,
        light: r.light,
        lightReason: r.light_reason,
        phaseName: phases.get(r.id) ?? null,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        progressPct: Number(r.progress_pct) || 0,
        pendingReviews: p ? Number(p.pending_reviews) || 0 : 0,
        portal: !p || !p.account_status ? ("none" as const) : p.last_login_at || p.account_status === "active" ? ("active" as const) : ("invited" as const),
      };
    }),
  };
}

export async function loadService(supabase: Db, workspaceId: string, serviceId: string) {
  const { data } = await svcSchema(supabase).from("services").select(`${COLS}, origin, origin_reason, previous_service_id, price_cents, paused_at, paused_days, extension_sale_ids, cancel_reason, completed_at`).eq("workspace_id", workspaceId).eq("id", serviceId).maybeSingle();
  if (!data) return null;
  const [phases, items] = await Promise.all([
    svcSchema(supabase).from("service_phases").select("id, template_key, name, position, status, duration_days, yellow_day, red_day, started_at, completed_at, challenge, awaiting_start").eq("service_id", serviceId).order("position"),
    svcSchema(supabase).from("service_items").select("id, phase_id, template_key, kind, name, required, status, due_on, due_at, completed_at, completed_source, task_id, needs_attention, is_recurring_template, parent_item_id, occurrence_index, position, ref, evidence").eq("service_id", serviceId).order("position"),
  ]);
  return {
    service: data as ServiceRow & Record<string, unknown>,
    phases: (phases.data ?? []) as Array<{ id: string; template_key: string; name: string; position: number; status: string; duration_days: number | null; yellow_day: number | null; red_day: number | null; started_at: string | null; completed_at: string | null; challenge: unknown; awaiting_start: boolean }>,
    items: (items.data ?? []) as Array<{ id: string; phase_id: string; template_key: string; kind: string; name: string; required: boolean; status: string; due_on: string | null; due_at: string | null; completed_at: string | null; completed_source: string | null; task_id: string | null; needs_attention: boolean; is_recurring_template: boolean; parent_item_id: string | null; occurrence_index: number | null; position: number; ref: Record<string, unknown> | null; evidence: unknown }>,
  };
}

/** Los servicios de un contacto (la ficha del cliente y la sección de la ficha del contacto). */
export async function loadContactServices(supabase: Db, workspaceId: string, contactId: string) {
  const { data } = await svcSchema(supabase).from("services").select(COLS).eq("workspace_id", workspaceId).eq("contact_id", contactId).order("created_at", { ascending: false });
  const rows = (data ?? []) as ServiceRow[];
  const phases = await currentPhases(supabase, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, phase_name: phases.get(r.id) ?? null }));
}

/** El servicio de cada venta de una página de Ventas (la columna Servicio, F95). Una consulta. */
export async function loadSaleServices(supabase: Db, workspaceId: string, saleIds: string[]) {
  const out = new Map<string, { serviceId: string; status: ServiceStatus; light: Light | null; phaseName: string | null; extendsProductName: string | null }>();
  if (saleIds.length === 0) return out;
  const { data } = await svcSchema(supabase).from("services").select("id, sale_id, status, light, product_snapshot, extension_sale_ids").eq("workspace_id", workspaceId).or(`sale_id.in.(${saleIds.join(",")}),extension_sale_ids.ov.{${saleIds.join(",")}}`);
  const rows = (data ?? []) as Array<{ id: string; sale_id: string | null; status: ServiceStatus; light: Light | null; product_snapshot: { product_name?: string } | null; extension_sale_ids: string[] | null }>;
  const phases = await currentPhases(supabase, rows.map((r) => r.id));
  for (const r of rows) {
    if (r.sale_id && saleIds.includes(r.sale_id)) out.set(r.sale_id, { serviceId: r.id, status: r.status, light: r.light, phaseName: phases.get(r.id) ?? null, extendsProductName: null });
    for (const s of r.extension_sale_ids ?? []) if (saleIds.includes(s)) out.set(s, { serviceId: r.id, status: r.status, light: r.light, phaseName: null, extendsProductName: r.product_snapshot?.product_name ?? "el programa" });
  }
  return out;
}
