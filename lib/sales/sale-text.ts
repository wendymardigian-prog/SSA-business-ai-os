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

/** Solo el nombre del producto (la columna «Producto» de las tablas; la variante tiene la suya). */
export function snapshotProductName(snapshot: unknown): string {
  const product = (snapshot as { product_name?: unknown } | null)?.product_name;
  return typeof product === "string" && product ? product : "Producto";
}

/** El nombre de la variante tal como se guardó (null si la venta no la tiene). */
export function snapshotVariantName(snapshot: unknown): string | null {
  const variant = (snapshot as { variant_name?: unknown } | null)?.variant_name;
  return typeof variant === "string" && variant.trim() ? variant : null;
}
