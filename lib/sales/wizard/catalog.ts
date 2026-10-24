/**
 * Lo que el asistente de venta ofrece del catálogo (plano F19): productos activos → variantes
 * activas, con el precio de la variante a la vista. Una variante sin precio (0) no se ofrece, y se
 * dice por qué. Puro.
 */
import { priceOrNull } from "@/lib/sales/catalog/price";
import { normalizeProductType, variantTiming, type VariantTiming } from "@/lib/sales/catalog/products";
import { describeBilling, describeTiming } from "@/lib/sales/catalog/variants";

export interface WizardVariant {
  id: string;
  name: string;
  billingType: string;
  billingInterval: string | null;
  /** El precio que se está mostrando (null = sin precio): `createSale` lo vuelve a leer. */
  price: number | null;
  /** «Pago único · 6 meses», «Pago único · 15 nov 2026 · 3 días» o «Pago único». */
  detail: string;
  /** La fecha fija de un evento (AAAA-MM-DD): el inicio del servicio de quien lo compra. */
  eventDate: string | null;
  /** Por qué no se puede vender (sin precio), o null. */
  unavailable: string | null;
}

export interface WizardProduct {
  id: string;
  name: string;
  type: string;
  /** Si sus variantes tienen duración (empieza al comprar), fecha fija (evento) o nada (producto). */
  timing: VariantTiming;
  variants: WizardVariant[];
}

interface ProductInput { id: string; name: string; product_type: string; status: string }
interface VariantInput {
  id: string; product_id: string; name: string; duration_type: string; duration_value: number | null;
  event_date?: string | null; billing_type: string; billing_interval: string | null; display_order: number | null; archived_at: string | null;
  price: unknown;
}

function variantDetail(v: VariantInput, timing: VariantTiming): string {
  const when = describeTiming(timing, v);
  return when ? `${describeBilling(v.billing_type, v.billing_interval)} · ${when}` : describeBilling(v.billing_type, v.billing_interval);
}

export function buildWizardCatalog(products: readonly ProductInput[], variants: readonly VariantInput[]): WizardProduct[] {
  return products
    .filter((p) => p.status === "active")
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: normalizeProductType(p.product_type),
      timing: variantTiming(p.product_type),
      variants: variants
        .filter((v) => v.product_id === p.id && !v.archived_at)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        .map((v): WizardVariant => {
          const price = priceOrNull(v.price);
          return {
            id: v.id,
            name: v.name,
            billingType: v.billing_type,
            billingInterval: v.billing_interval,
            price,
            detail: variantDetail(v, variantTiming(p.product_type)),
            eventDate: variantTiming(p.product_type) === "event" ? (v.event_date ?? null) : null,
            unavailable: price != null ? null : "Sin precio: cargalo en Ajustes › Productos",
          };
        }),
    }))
    .filter((p) => p.variants.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
