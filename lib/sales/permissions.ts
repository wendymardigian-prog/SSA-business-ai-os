/**
 * Quien ve una venta (plano §5). Espejo puro de `can_see_sale` (00162):
 * admin, o setter, o vendedor, o `sales.view` con alcance `all`.
 *
 * La RLS decide de verdad; esto sirve para pantallas y Server Actions que ya
 * tienen la venta cargada y para los tests de paridad.
 */
import { can, scopeFor, type RolePermissions } from "@/lib/auth/permissions";

export interface SaleViewer {
  userId: string;
  role: "owner" | "admin" | "member";
  permissions: RolePermissions | null | undefined;
}

export interface SaleVisibilityInput {
  setter_id: string | null;
  vendedor_id: string | null;
}

export function canSeeSale(viewer: SaleViewer, sale: SaleVisibilityInput): boolean {
  if (viewer.role === "owner" || viewer.role === "admin") return true;
  if (sale.setter_id === viewer.userId || sale.vendedor_id === viewer.userId) return true;
  return can(viewer.permissions, "sales.view") && scopeFor(viewer.permissions, "sales") === "all";
}

/** Un Member con alcance `own` solo puede crear ventas donde queda como setter o vendedor (D11). */
export function canCreateSaleFor(viewer: SaleViewer, sale: SaleVisibilityInput): boolean {
  if (!can(viewer.permissions, "sales.manage")) return false;
  if (viewer.role === "owner" || viewer.role === "admin") return true;
  if (scopeFor(viewer.permissions, "sales") === "all") return true;
  return sale.setter_id === viewer.userId || sale.vendedor_id === viewer.userId;
}
