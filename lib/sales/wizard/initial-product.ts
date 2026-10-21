import type { WizardProduct } from "./catalog";

/**
 * El producto y la variante con que arranca el paso 2 de «Nueva venta»: los de
 * interés del contacto (00246), solo si están en el catálogo vendible. Una
 * variante sin precio no se preselecciona (no se puede vender); el producto sí.
 * Puro.
 */
export function initialProduct(
  config: { catalog: readonly WizardProduct[] },
  initial?: { productId?: string | null; variantId?: string | null },
): { productId: string; variantId: string } {
  const product = initial?.productId ? config.catalog.find((p) => p.id === initial.productId) : undefined;
  if (!product) return { productId: "", variantId: "" };
  const variant = initial?.variantId ? product.variants.find((v) => v.id === initial.variantId && !v.unavailable) : undefined;
  return { productId: product.id, variantId: variant?.id ?? "" };
}
