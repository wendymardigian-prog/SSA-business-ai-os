/**
 * «De qué productos y variantes» en un disparador: una, varias o todas. PURO.
 *
 * Se guarda en la config del disparador como dos listas:
 *  - `product_ids`: productos elegidos ENTEROS (cualquier variante, también las que se creen después).
 *  - `variant_ids`: variantes sueltas (de productos que no se eligieron enteros).
 *
 * Reglas:
 *  - Las dos vacías = todos los productos, también los que se creen más adelante.
 *  - Un evento pasa si su producto está en `product_ids` O su variante en `variant_ids`.
 *  - Se siguen entendiendo los filtros viejos de un solo valor (`product_id`, `variant_id`): una variante vieja ya
 *    implica su producto, así que alcanza con la variante; si no había variante, el producto entero.
 */

export interface ProductScope {
  productIds: string[];
  variantIds: string[];
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function list(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(text).filter((x): x is string => x !== null))];
}

/** Lo elegido en la config, con los filtros viejos de un solo valor convertidos a lista. */
export function readProductScope(config: unknown): ProductScope {
  const c = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const productIds = list(c.product_ids);
  const variantIds = list(c.variant_ids);
  if (productIds.length === 0 && variantIds.length === 0) {
    const variant = text(c.variant_id);
    const product = text(c.product_id);
    if (variant) return { productIds: [], variantIds: [variant] };
    if (product) return { productIds: [product], variantIds: [] };
  }
  return { productIds, variantIds };
}

export function isEmptyScope(scope: ProductScope): boolean {
  return scope.productIds.length === 0 && scope.variantIds.length === 0;
}

/** ¿El producto y la variante de un evento entran en lo elegido? Sin nada elegido, sí. */
export function productScopeMatches(scope: ProductScope, productId: unknown, variantId: unknown): boolean {
  if (isEmptyScope(scope)) return true;
  const product = text(productId);
  const variant = text(variantId);
  if (product && scope.productIds.includes(product)) return true;
  if (variant && scope.variantIds.includes(variant)) return true;
  return false;
}

/**
 * Lo que se escribe en la config al guardar: las dos listas (o nada) y SIN los filtros viejos de un solo valor, para
 * que no queden dos fuentes que digan cosas distintas.
 */
export function writeProductScope(scope: ProductScope): { product_ids?: string[]; variant_ids?: string[]; product_id: null; variant_id: null } {
  return {
    ...(scope.productIds.length > 0 ? { product_ids: [...new Set(scope.productIds)] } : { product_ids: undefined }),
    ...(scope.variantIds.length > 0 ? { variant_ids: [...new Set(scope.variantIds)] } : { variant_ids: undefined }),
    product_id: null,
    variant_id: null,
  };
}

export interface ScopeCatalogProduct {
  id: string;
  name: string;
  variants: Array<{ id: string; name: string }>;
}

/** Elegir o soltar un producto entero: sus variantes sueltas dejan de hacer falta. */
export function toggleScopeProduct(scope: ProductScope, product: ScopeCatalogProduct): ProductScope {
  if (scope.productIds.includes(product.id)) return { ...scope, productIds: scope.productIds.filter((id) => id !== product.id) };
  const own = new Set(product.variants.map((v) => v.id));
  return { productIds: [...scope.productIds, product.id], variantIds: scope.variantIds.filter((id) => !own.has(id)) };
}

/** Elegir o soltar una variante suelta. Con el producto elegido entero, no hace nada (ya entra). */
export function toggleScopeVariant(scope: ProductScope, productId: string, variantId: string): ProductScope {
  if (scope.productIds.includes(productId)) return scope;
  return scope.variantIds.includes(variantId)
    ? { ...scope, variantIds: scope.variantIds.filter((id) => id !== variantId) }
    : { ...scope, variantIds: [...scope.variantIds, variantId] };
}

/** Lo elegido que ya no está en el catálogo (producto o variante borrados o archivados): se avisa, no se vacía solo. */
export function staleScopeIds(scope: ProductScope, catalog: readonly ScopeCatalogProduct[]): { products: string[]; variants: string[] } {
  const products = new Set(catalog.map((p) => p.id));
  const variants = new Set(catalog.flatMap((p) => p.variants.map((v) => v.id)));
  return { products: scope.productIds.filter((id) => !products.has(id)), variants: scope.variantIds.filter((id) => !variants.has(id)) };
}

/** En palabras, para el resumen del disparador: «Lite y Pro (variante Anual)». Vacío = «cualquier producto». */
export function describeProductScope(scope: ProductScope, catalog: readonly ScopeCatalogProduct[]): string {
  if (isEmptyScope(scope)) return "cualquier producto";
  const parts: string[] = [];
  for (const p of catalog) {
    if (scope.productIds.includes(p.id)) parts.push(p.name);
    else {
      const vs = p.variants.filter((v) => scope.variantIds.includes(v.id)).map((v) => v.name);
      if (vs.length > 0) parts.push(`${p.name} (${vs.join(", ")})`);
    }
  }
  const stale = staleScopeIds(scope, catalog);
  const missing = stale.products.length + stale.variants.length;
  if (missing > 0) parts.push(missing === 1 ? "1 que ya no existe" : `${missing} que ya no existen`);
  return parts.join(", ");
}
