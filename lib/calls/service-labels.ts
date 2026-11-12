// @plantilla-quitar(servicios)
/**
 * Los nombres de los servicios de unas reuniones (Servicios A4, F136): «Producto · Variante». Solo servidor.
 *
 * Se lee con el cliente de servicio filtrando por el negocio de la sesión: quien llama ya miró `calls.view` y la RLS
 * de `calls` ya decidió qué reuniones ve. Solo devuelve nombres de producto y variante (nada del cliente).
 */
import { svcSchema } from "@/lib/services/db";

export type ServiceLabel = { id: string; label: string; contactId: string; status: string; startsOn: string | null; endsOn: string | null };

type AnyDb = { from: (t: string) => unknown };

export function serviceLabelText(product: string | null | undefined, variant: string | null | undefined): string {
  const p = (product ?? "").trim();
  const v = (variant ?? "").trim();
  if (p && v) return `${p} · ${v}`;
  return p || v || "Servicio";
}

export async function loadServiceLabels(db: AnyDb, workspaceId: string, serviceIds: string[]): Promise<Map<string, ServiceLabel>> {
  const ids = [...new Set(serviceIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  const out = new Map<string, ServiceLabel>();
  if (ids.length === 0) return out;
  const { data: services } = await svcSchema(db)
    .from("services")
    .select("id, contact_id, product_id, product_variant_id, status, starts_on, ends_on")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  const rows = (services ?? []) as Array<{ id: string; contact_id: string; product_id: string | null; product_variant_id: string | null; status: string; starts_on: string | null; ends_on: string | null }>;
  if (rows.length === 0) return out;
  const productIds = [...new Set(rows.map((r) => r.product_id).filter((x): x is string => Boolean(x)))];
  const variantIds = [...new Set(rows.map((r) => r.product_variant_id).filter((x): x is string => Boolean(x)))];
  const fromTable = (t: string) => (db.from(t) as { select: (c: string) => { eq: (k: string, v: string) => { in: (k: string, v: string[]) => Promise<{ data: unknown }> } } });
  const [products, variants] = await Promise.all([
    productIds.length ? fromTable("products").select("id, name").eq("workspace_id", workspaceId).in("id", productIds) : Promise.resolve({ data: [] }),
    variantIds.length ? fromTable("product_variants").select("id, name").eq("workspace_id", workspaceId).in("id", variantIds) : Promise.resolve({ data: [] }),
  ]);
  const pName = new Map(((products.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
  const vName = new Map(((variants.data ?? []) as Array<{ id: string; name: string }>).map((v) => [v.id, v.name]));
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      label: serviceLabelText(r.product_id ? pName.get(r.product_id) : null, r.product_variant_id ? vName.get(r.product_variant_id) : null),
      contactId: r.contact_id,
      status: r.status,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
    });
  }
  return out;
}

/** El área Servicio y el tipo Clase del negocio (para el filtro «Sin servicio»). */
export async function loadServiceCategoryIds(db: AnyDb, workspaceId: string): Promise<{ areaId: string | null; classId: string | null }> {
  const q = db.from("booking_categories") as { select: (c: string) => { eq: (k: string, v: string) => { in: (k: string, v: string[]) => Promise<{ data: unknown }> } } };
  const { data } = await q.select("id, system_key").eq("workspace_id", workspaceId).in("system_key", ["servicio", "servicio.clase"]);
  const rows = (data ?? []) as Array<{ id: string; system_key: string }>;
  return {
    areaId: rows.find((r) => r.system_key === "servicio")?.id ?? null,
    classId: rows.find((r) => r.system_key === "servicio.clase")?.id ?? null,
  };
}
