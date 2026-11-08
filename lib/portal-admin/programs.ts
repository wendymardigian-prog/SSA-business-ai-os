// @plantilla-quitar(servicios)
/**
 * Portal › Programas (F35), puro: las tarjetas de los productos con portal y lo que ofrece «+ Agregar programa».
 * Un programa es un producto con `portal_enabled` (lo mantiene la base: al menos una variante con acceso).
 */
import { AVAILABLE_SECTIONS, SECTION_LABELS } from "@/lib/services/availability";

export interface ProgramProductRow {
  id: string;
  name: string;
  status: string;
  portal_enabled: boolean;
  portal_settings: Record<string, unknown> | null;
}
export interface ProgramVariantRow {
  id: string;
  product_id: string;
  name: string;
  status?: string | null;
  portal_settings: Record<string, unknown> | null;
}

export interface ProgramCard {
  id: string;
  name: string;
  variantsWithAccess: number;
  variantsTotal: number;
  sectionsOn: string[];
}

const variantOn = (v: ProgramVariantRow) => (v.portal_settings as { enabled?: boolean } | null)?.enabled === true;

export function programCards(products: ProgramProductRow[], variants: ProgramVariantRow[]): ProgramCard[] {
  return products
    .filter((p) => p.portal_enabled)
    .map((p) => {
      const own = variants.filter((v) => v.product_id === p.id);
      const sections = ((p.portal_settings as { sections?: Record<string, boolean> } | null)?.sections ?? {}) as Record<string, boolean>;
      return {
        id: p.id,
        name: p.name,
        variantsWithAccess: own.filter(variantOn).length,
        variantsTotal: own.length,
        sectionsOn: AVAILABLE_SECTIONS.filter((s) => sections[s] !== false).map((s) => SECTION_LABELS[s]),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Lo que se puede agregar: productos activos sin portal, con sus variantes. */
export function addableProducts(products: ProgramProductRow[], variants: ProgramVariantRow[]) {
  return products
    .filter((p) => !p.portal_enabled && p.status === "active")
    .map((p) => ({ id: p.id, name: p.name, variants: variants.filter((v) => v.product_id === p.id).map((v) => ({ id: v.id, name: v.name })) }))
    .filter((p) => p.variants.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** «Agregar programa» sin ninguna variante elegida se rechaza (F35). */
export function addProgramProblem(productId: string | null, variantIds: string[]): string | null {
  if (!productId) return "Elegí el producto";
  if (variantIds.length === 0) return "Elegí al menos una variante con acceso al portal";
  return null;
}
