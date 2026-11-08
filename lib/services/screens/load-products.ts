// @plantilla-quitar(servicios)
/**
 * Lecturas de Ajustes › Productos con el módulo prendido (F114). Con el cliente del USUARIO: la RLS de `products`,
 * `product_variants` y `app_servicio.services` decide qué ve. Los servicios activos se cuentan sobre los que la
 * persona puede ver (un rol con alcance `own` ve menos: es lo esperado).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { svcSchema } from "../db";
import { normalizeProductType, PRODUCT_TYPE_LABELS } from "@/lib/catalog/products";
import { PRODUCT_STATUS_LABEL, isProductStatus } from "@/lib/content/taxonomy";
import { priceOrNull } from "@/lib/catalog/price";
import type { JourneyTemplate } from "../journey-template";
import type { ProductCardInput, VariantFacts } from "./product-cards";

type Db = SupabaseClient<any, any, any>;

export interface ServiceVariant extends VariantFacts {
  productId: string;
  displayOrder: number;
  durationType: string;
  durationValue: number | null;
  eventDate: string | null;
  billingType: string;
  billingInterval: string | null;
  rawPrice: number;
  serviceSettingsRev: number;
  journeyTemplateRev: number;
  portalSettingsRev: number;
}

export interface ServiceProduct extends ProductCardInput {
  description: string | null;
  type: string;
  status: string;
  portalSettings: unknown;
  portalSettingsRev: number;
  variants: ServiceVariant[];
}

const VARIANT_COLS =
  "id, product_id, name, display_order, price, archived_at, duration_type, duration_value, event_date, billing_type, billing_interval, service_settings, service_settings_rev, journey_template, journey_template_rev, portal_settings, portal_settings_rev";

async function activeServicesByVariant(supabase: Db, workspaceId: string, productId?: string): Promise<Map<string, number>> {
  let q = svcSchema(supabase).from("services").select("product_variant_id").eq("workspace_id", workspaceId).in("status", ["active", "paused"]);
  if (productId) q = q.eq("product_id", productId);
  const { data, error } = await q;
  if (error) console.error("[servicios] no pude contar los servicios activos:", error.message);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ product_variant_id: string | null }>) {
    if (r.product_variant_id) out.set(r.product_variant_id, (out.get(r.product_variant_id) ?? 0) + 1);
  }
  return out;
}

function toVariant(v: Record<string, unknown>, counts: Map<string, number>): ServiceVariant {
  return {
    id: v.id as string,
    productId: v.product_id as string,
    name: v.name as string,
    archived: !!v.archived_at,
    price: priceOrNull(v.price as number),
    rawPrice: Number(v.price) || 0,
    displayOrder: Number(v.display_order) || 0,
    durationType: v.duration_type as string,
    durationValue: (v.duration_value as number | null) ?? null,
    eventDate: (v.event_date as string | null) ?? null,
    billingType: v.billing_type as string,
    billingInterval: (v.billing_interval as string | null) ?? null,
    serviceSettings: v.service_settings ?? {},
    serviceSettingsRev: Number(v.service_settings_rev) || 0,
    journeyTemplate: (v.journey_template as JourneyTemplate | null) ?? null,
    journeyTemplateRev: Number(v.journey_template_rev) || 0,
    portalSettings: v.portal_settings ?? {},
    portalSettingsRev: Number(v.portal_settings_rev) || 0,
    activeServices: counts.get(v.id as string) ?? 0,
  };
}

function toProduct(p: Record<string, unknown>, variants: ServiceVariant[]): ServiceProduct {
  const type = normalizeProductType(p.product_type as string);
  const status = p.status as string;
  return {
    id: p.id as string,
    name: p.name as string,
    description: (p.description as string | null) ?? null,
    type,
    typeLabel: PRODUCT_TYPE_LABELS[type],
    status,
    statusLabel: isProductStatus(status) ? PRODUCT_STATUS_LABEL[status] : status,
    portalSettings: p.portal_settings ?? {},
    portalSettingsRev: Number(p.portal_settings_rev) || 0,
    variants,
  };
}

export async function loadServiceProducts(supabase: Db, workspaceId: string): Promise<ServiceProduct[]> {
  const [products, variants, counts] = await Promise.all([
    supabase.from("products").select("id, name, description, product_type, status, portal_settings, portal_settings_rev").eq("workspace_id", workspaceId).order("name"),
    supabase.from("product_variants").select(VARIANT_COLS).eq("workspace_id", workspaceId).order("display_order"),
    activeServicesByVariant(supabase, workspaceId),
  ]);
  if (products.error) console.error("[servicios] no pude leer los productos:", products.error.message);
  const vs = ((variants.data ?? []) as Record<string, unknown>[]).map((v) => toVariant(v, counts));
  return ((products.data ?? []) as Record<string, unknown>[]).map((p) => toProduct(p, vs.filter((v) => v.productId === p.id)));
}

export async function loadServiceProduct(supabase: Db, workspaceId: string, productId: string): Promise<ServiceProduct | null> {
  const [product, variants, counts] = await Promise.all([
    supabase.from("products").select("id, name, description, product_type, status, portal_settings, portal_settings_rev").eq("workspace_id", workspaceId).eq("id", productId).maybeSingle(),
    supabase.from("product_variants").select(VARIANT_COLS).eq("workspace_id", workspaceId).eq("product_id", productId).order("display_order"),
    activeServicesByVariant(supabase, workspaceId, productId),
  ]);
  if (!product.data) return null;
  return toProduct(product.data as Record<string, unknown>, ((variants.data ?? []) as Record<string, unknown>[]).map((v) => toVariant(v, counts)));
}
