/**
 * Lo que el asistente de venta ofrece del catálogo (plano F19): productos activos → variantes
 * activas, con el precio de la versión ACTIVA a la vista. Una variante sin versión activa no se
 * ofrece, y se dice por qué. Puro.
 */
import { describeBilling, describeDuration } from "@/lib/sales/catalog/variants";

export interface WizardVariant {
  id: string;
  name: string;
  billingType: string;
  billingInterval: string | null;
  /** La versión activa que se está mostrando: `createSale` la vuelve a leer. */
  versionId: string | null;
  price: number | null;
  /** «Pago único · De por vida». */
  detail: string;
  /** Por qué no se puede vender (sin precio vigente), o null. */
  unavailable: string | null;
}

export interface WizardProduct {
  id: string;
  name: string;
  type: string;
  variants: WizardVariant[];
}

interface ProductInput { id: string; name: string; product_type: string; status: string }
interface VariantInput {
  id: string; product_id: string; name: string; duration_type: string; duration_value: number | null;
  billing_type: string; billing_interval: string | null; display_order: number | null; archived_at: string | null;
}
interface VersionInput { id: string; product_variant_id: string; price: unknown; status: string }

function variantDetail(v: VariantInput): string {
  return `${describeBilling(v.billing_type, v.billing_interval)} · ${describeDuration(v.duration_type, v.duration_value)}`;
}

export function buildWizardCatalog(products: readonly ProductInput[], variants: readonly VariantInput[], versions: readonly VersionInput[]): WizardProduct[] {
  const active = new Map<string, VersionInput>();
  for (const v of versions) if (v.status === "active") active.set(v.product_variant_id, v);

  return products
    .filter((p) => p.status === "active")
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.product_type,
      variants: variants
        .filter((v) => v.product_id === p.id && !v.archived_at)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        .map((v): WizardVariant => {
          const version = active.get(v.id);
          return {
            id: v.id,
            name: v.name,
            billingType: v.billing_type,
            billingInterval: v.billing_interval,
            versionId: version?.id ?? null,
            price: version ? Number(version.price) || 0 : null,
            detail: variantDetail(v),
            unavailable: version ? null : "Sin precio vigente: publicá una versión en Ajustes › Productos",
          };
        }),
    }))
    .filter((p) => p.variants.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
