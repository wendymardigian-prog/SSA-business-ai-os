/**
 * Productos (plano F3). Lógica de la pantalla de Ajustes > Productos y de los
 * selectores de venta/Contenido. La pantalla de Contenido conserva sus tres
 * estados (Activo, Inactivo, Discontinuado): se leen de `products.status`.
 */
import { z } from "zod";
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL, TAXONOMY_NAME_MAX, isProductStatus, type ProductStatus } from "@/lib/content/taxonomy";
import { formatMoney } from "../format";

export const PRODUCT_TYPES = ["programa", "mentoria", "curso", "servicio", "otro"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  programa: "Programa",
  mentoria: "Mentoría",
  curso: "Curso",
  servicio: "Servicio",
  otro: "Otro",
};

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(TAXONOMY_NAME_MAX, `Máximo ${TAXONOMY_NAME_MAX} caracteres`),
  type: z.enum(PRODUCT_TYPES).default("otro"),
  description: z.string().trim().max(1000, "Máximo 1000 caracteres").optional().nullable(),
});

export type ProductInput = z.input<typeof productInputSchema>;

export interface ProductRowInput {
  id: string;
  name: string;
  product_type: string;
  status: string;
  description?: string | null;
}

export interface ProductRow {
  id: string;
  name: string;
  type: ProductType;
  typeLabel: string;
  status: ProductStatus;
  statusLabel: string;
  variants: number;
  /** Precio de la variante por defecto (la de menor `display_order`) o null. */
  defaultPrice: number | null;
  priceLabel: string;
  /** Cuántas piezas de Contenido lo usan. */
  pieces: number;
}

const STATUS_ORDER: Record<ProductStatus, number> = { active: 0, inactive: 1, discontinued: 2 };

export interface VariantPriceInput {
  display_order: number;
  archived_at: string | null;
  activePrice: number | null;
}

/** El precio de la variante por defecto: la de menor orden, no archivada. */
export function defaultVariantPrice(variants: readonly VariantPriceInput[]): number | null {
  const live = variants.filter((v) => !v.archived_at).sort((a, b) => a.display_order - b.display_order);
  return live[0]?.activePrice ?? null;
}

/** Solo un producto activo se ofrece en el selector de venta nueva y en los de Contenido. */
export function isSellable(product: { status: string }): boolean {
  return product.status === "active";
}

export function productRow(
  product: ProductRowInput,
  variants: readonly VariantPriceInput[],
  pieces: number,
): ProductRow {
  const status: ProductStatus = isProductStatus(product.status) ? product.status : "active";
  const type = (PRODUCT_TYPES as readonly string[]).includes(product.product_type) ? (product.product_type as ProductType) : "otro";
  const defaultPrice = defaultVariantPrice(variants);
  return {
    id: product.id,
    name: product.name,
    type,
    typeLabel: PRODUCT_TYPE_LABELS[type],
    status,
    statusLabel: PRODUCT_STATUS_LABEL[status],
    variants: variants.filter((v) => !v.archived_at).length,
    defaultPrice,
    priceLabel: defaultPrice === null ? "Sin precio" : formatMoney(defaultPrice),
    pieces,
  };
}

/** Activos, inactivos y discontinuados; dentro de cada uno, por nombre en español. */
export function sortProducts<T extends { status: ProductStatus; name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, "es"));
}

/** Filtra los discontinuados salvo que se pida verlos. */
export function visibleProducts<T extends { status: ProductStatus }>(rows: readonly T[], showDiscontinued: boolean): T[] {
  return showDiscontinued ? [...rows] : rows.filter((r) => r.status !== "discontinued");
}

export function piecesLabel(pieces: number): string {
  return pieces === 0 ? "Sin piezas" : `${pieces} ${pieces === 1 ? "pieza" : "piezas"}`;
}

export { PRODUCT_STATUSES, PRODUCT_STATUS_LABEL };
