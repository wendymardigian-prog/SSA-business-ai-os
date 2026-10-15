/**
 * Quién entra a la pantalla de reglas y qué rol se muestra (F57). Puro.
 *
 *   manage  `commissions.manage`: crea, edita, ordena, prueba y administra los roles.
 *   read    `commissions.view` con alcance `all`: ve las reglas, no cambia nada.
 *   none    el resto: la página lo manda a la lista de comisiones.
 */
import type { PermissionScope } from "@/lib/auth/permissions";
import type { CommissionRole } from "./types";

export type RulesAccess = "manage" | "read" | "none";

export const RULES_PATH = "/dashboard/finanzas/comisiones/reglas";
export const COMMISSIONS_PATH = "/dashboard/finanzas/comisiones";

export function rulesAccess(can: (key: string) => boolean, commissionsScope: PermissionScope): RulesAccess {
  if (can("commissions.manage")) return "manage";
  if (can("commissions.view") && commissionsScope === "all") return "read";
  return "none";
}

/** Los roles que tienen pestaña: los activos, en el orden en que están. */
export function activeRoles<T extends Pick<CommissionRole, "active">>(roles: readonly T[]): T[] {
  return roles.filter((r) => r.active);
}

/** La pestaña a mostrar según `?rol=`: la pedida si existe y está activa; si no, la primera activa; null si no hay ninguna. */
export function pickRoleTab(param: string | string[] | undefined, roles: ReadonlyArray<Pick<CommissionRole, "key" | "active">>): string | null {
  const wanted = (Array.isArray(param) ? param[0] : param)?.trim() ?? "";
  const active = activeRoles(roles);
  if (wanted && active.some((r) => r.key === wanted)) return wanted;
  return active[0]?.key ?? null;
}

export function roleTabHref(key: string): string {
  return `${RULES_PATH}?rol=${encodeURIComponent(key)}`;
}
