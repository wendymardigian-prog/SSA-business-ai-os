/**
 * El producto de interés de un contacto (00246), con su variante opcional.
 *
 * Puro: arma lo que muestran los selectores de la ficha, la bandeja y la
 * lista. Un producto o una variante ARCHIVADOS no se ofrecen para elegir, pero
 * si el contacto ya los tiene se siguen viendo (con "(archivado)"). Una
 * variante sin precio SÍ se ofrece: esto es interés, no una venta.
 */

export interface InterestVariant {
  id: string;
  name: string;
  archived: boolean;
}

export interface InterestProduct {
  id: string;
  name: string;
  archived: boolean;
  variants: InterestVariant[];
}

export type InterestCatalog = InterestProduct[];

interface ProductRow {
  id: string;
  name: string;
  status: string;
  archived_at?: string | null;
}

interface VariantRow {
  id: string;
  product_id: string;
  name: string;
  archived_at: string | null;
  display_order?: number | null;
}

export function buildInterestCatalog(products: readonly ProductRow[], variants: readonly VariantRow[]): InterestCatalog {
  return products
    .map((p) => ({
      id: p.id,
      name: p.name,
      archived: p.status !== "active" || Boolean(p.archived_at),
      variants: variants
        .filter((v) => v.product_id === p.id)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name, "es"))
        .map((v) => ({ id: v.id, name: v.name, archived: Boolean(v.archived_at) })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Los productos que se ofrecen: los activos, más el que el contacto ya tiene aunque esté archivado. */
export function offeredProducts(catalog: InterestCatalog, currentProductId: string | null): InterestProduct[] {
  return catalog.filter((p) => !p.archived || p.id === currentProductId);
}

/** Las variantes que se ofrecen de un producto: las activas, más la actual aunque esté archivada. */
export function offeredVariants(catalog: InterestCatalog, productId: string | null, currentVariantId: string | null): InterestVariant[] {
  const product = catalog.find((p) => p.id === productId);
  if (!product) return [];
  return product.variants.filter((v) => !v.archived || v.id === currentVariantId);
}

const archivedSuffix = (archived: boolean) => (archived ? " (archivado)" : "");

/** "Programa VIP · Mensual", o solo el producto, o "—". */
export function interestLabel(catalog: InterestCatalog, productId: string | null, variantId: string | null): string {
  if (!productId) return "—";
  const product = catalog.find((p) => p.id === productId);
  if (!product) return "Producto borrado";
  const variant = variantId ? product.variants.find((v) => v.id === variantId) : null;
  const base = `${product.name}${archivedSuffix(product.archived)}`;
  return variant ? `${base} · ${variant.name}${archivedSuffix(variant.archived)}` : base;
}

export type InterestCheck = { ok: true } | { ok: false; error: string };

/**
 * Lo que se puede guardar: una variante necesita su producto y tiene que ser
 * de él; un producto o una variante archivados solo si ya eran los del contacto.
 */
export function checkInterestChange(
  catalog: InterestCatalog,
  current: { productId: string | null; variantId: string | null },
  next: { productId: string | null; variantId: string | null },
): InterestCheck {
  if (!next.productId) return next.variantId ? { ok: false, error: "Elegí primero el producto" } : { ok: true };
  const product = catalog.find((p) => p.id === next.productId);
  if (!product) return { ok: false, error: "Ese producto no existe" };
  if (product.archived && product.id !== current.productId) return { ok: false, error: "Ese producto está archivado" };
  if (!next.variantId) return { ok: true };
  const variant = product.variants.find((v) => v.id === next.variantId);
  if (!variant) return { ok: false, error: "Esa variante no es de ese producto" };
  if (variant.archived && variant.id !== current.variantId) return { ok: false, error: "Esa variante está archivada" };
  return { ok: true };
}
