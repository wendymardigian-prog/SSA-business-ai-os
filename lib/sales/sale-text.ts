/** Textos que salen del snapshot del producto de una venta (una sola lectura, tolerante). */

export function snapshotText(snapshot: unknown): string {
  const s = (snapshot ?? {}) as Record<string, unknown>;
  const product = typeof s.product_name === "string" ? s.product_name : "";
  const variant = typeof s.variant_name === "string" ? s.variant_name : "";
  if (!product) return "Producto";
  return variant && variant.toLowerCase() !== "estándar" && variant.toLowerCase() !== "estandar" ? `${product} · ${variant}` : product;
}

export function snapshotProductId(snapshot: unknown): string | null {
  const id = (snapshot as { product_id?: unknown } | null)?.product_id;
  return typeof id === "string" ? id : null;
}
