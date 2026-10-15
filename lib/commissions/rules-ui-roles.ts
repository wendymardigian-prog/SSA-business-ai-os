/**
 * El diálogo de roles (F57). Puro: agregar, renombrar y activar/desactivar sobre una copia de la lista, y la
 * validación con la misma función que usa el servidor (`validateRolesUpdate`). Un rol no se borra, no cambia de
 * clave ni de «a quién se le paga»: esta pantalla ni lo ofrece.
 */
import { newRoleKey, payeeLabel, validateRolesUpdate, ROLE_NAME_MAX } from "./roles";
import { COMMISSION_PAYEES, type CommissionPayee, type CommissionRole } from "./types";

/** Lo que se ofrece al crear un rol: las cuatro formas de decidir a quién se le paga. */
export const PAYEE_CHOICES: ReadonlyArray<{ value: CommissionPayee; label: string; hint: string }> = COMMISSION_PAYEES.map((value) => ({
  value,
  label: payeeLabel(value),
  hint:
    value === "sale_vendedor"
      ? "Cobra quien figura como vendedor en la venta."
      : value === "sale_setter"
        ? "Cobra quien figura como setter en la venta."
        : value === "content_assignee"
          ? "Cobra el responsable de la pieza que trajo la venta."
          : "Cada regla dice qué persona cobra.",
}));

/** Agrega un rol al final. El nombre vacío no agrega nada. */
export function addRole(roles: readonly CommissionRole[], name: string, payee: CommissionPayee, nowIso: string): CommissionRole[] {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return [...roles];
  return [...roles, { key: newRoleKey(clean, roles), name: clean, payee, active: true, system: false, created_at: nowIso }];
}

export function renameRole(roles: readonly CommissionRole[], key: string, name: string): CommissionRole[] {
  return roles.map((r) => (r.key === key ? { ...r, name } : r));
}

export function setRoleActive(roles: readonly CommissionRole[], key: string, active: boolean): CommissionRole[] {
  return roles.map((r) => (r.key === key ? { ...r, active } : r));
}

/** Lo que cambió respecto de lo guardado (para habilitar «Guardar»). */
export function rolesChanged(before: readonly CommissionRole[], after: readonly CommissionRole[]): boolean {
  const slim = (r: CommissionRole) => [r.key, r.name.trim(), r.payee, r.active];
  return JSON.stringify(before.map(slim)) !== JSON.stringify(after.map(slim));
}

/** El primer problema de la lista, con el mismo texto que daría el servidor. Null = se puede guardar. */
export function rolesProblem(before: readonly CommissionRole[], after: readonly CommissionRole[]): string | null {
  const check = validateRolesUpdate(before, after.map((r) => ({ ...r, name: r.name.trim() })));
  return check.ok ? null : (check.issues[0]?.message ?? "Los roles no son válidos");
}

/** Los problemas por rol, para mostrar cada uno junto a su nombre. */
export function roleProblems(before: readonly CommissionRole[], after: readonly CommissionRole[]): Record<string, string> {
  const check = validateRolesUpdate(before, after.map((r) => ({ ...r, name: r.name.trim() })));
  const out: Record<string, string> = {};
  for (const issue of check.issues) if (!out[issue.key]) out[issue.key] = issue.message;
  return out;
}

/** Lo que se manda a `updateCommissionRoles`. */
export function rolesPayload(roles: readonly CommissionRole[]): Array<{ key: string; name: string; payee: string; active: boolean }> {
  return roles.map((r) => ({ key: r.key, name: r.name.trim(), payee: r.payee, active: r.active }));
}

export { ROLE_NAME_MAX };
