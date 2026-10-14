/**
 * Auditoría de roles agrupada por sesión de edición (Equipo y roles, F13).
 *
 * Con guardado automático, tildar diez permisos serían diez filas en el historial. Los cambios de la
 * MISMA persona sobre el MISMO rol dentro de los 10 minutos se suman a una sola fila, con la lista
 * de claves agregadas y quitadas. Una clave que se agrega y se quita en la misma sesión se cancela.
 *
 * Puro: la acción busca la fila anterior en la base y le pasa su metadata a `mergeRoleAuditSession`.
 */

/** Cuánto dura una sesión de edición: pasado esto, el cambio abre una fila nueva. */
export const AUDIT_SESSION_MS = 10 * 60 * 1000;

export interface RoleAuditChange {
  addedKeys: string[];
  removedKeys: string[];
  /** Cambió el nombre (o la descripción) en esta sesión. */
  renamedTo?: string | null;
  /** Alcances que cambiaron: módulo → valor final. */
  scopes?: Record<string, string>;
}

export interface RoleAuditMetadata {
  kind: "role_updated";
  role_id: string;
  name: string;
  added_keys: string[];
  removed_keys: string[];
  scopes: Record<string, string>;
  changes: number;
}

const uniq = (list: string[]) => [...new Set(list)];

/** Si la fila anterior sigue siendo "la misma sesión" (misma persona, mismo rol, dentro de la ventana). */
export function isSameSession(
  previous: { performedAt: string; performedBy: string | null; metadata: { role_id?: string } | null } | null,
  now: Date,
  actorId: string,
  roleId: string,
): boolean {
  if (!previous || previous.performedBy !== actorId) return false;
  if (previous.metadata?.role_id !== roleId) return false;
  return now.getTime() - new Date(previous.performedAt).getTime() < AUDIT_SESSION_MS;
}

/** La metadata de la fila después de sumarle un cambio. Sin fila anterior, arranca una nueva. */
export function mergeRoleAuditSession(
  previous: Partial<RoleAuditMetadata> | null,
  roleId: string,
  roleName: string,
  change: RoleAuditChange,
): RoleAuditMetadata {
  const added = new Set(previous?.added_keys ?? []);
  const removed = new Set(previous?.removed_keys ?? []);

  for (const key of change.addedKeys) {
    // Agregar algo que se había quitado en esta sesión deja el rol como estaba: se cancelan.
    if (removed.has(key)) removed.delete(key);
    else added.add(key);
  }
  for (const key of change.removedKeys) {
    if (added.has(key)) added.delete(key);
    else removed.add(key);
  }

  const scopes = { ...(previous?.scopes ?? {}), ...(change.scopes ?? {}) };
  return {
    kind: "role_updated",
    role_id: roleId,
    name: change.renamedTo ?? roleName,
    added_keys: uniq([...added]).sort(),
    removed_keys: uniq([...removed]).sort(),
    scopes,
    changes: (previous?.changes ?? 0) + 1,
  };
}

/** Si la sesión terminó sin ningún cambio neto (todo se cancelo): no vale la pena dejar la fila. */
export function isEmptyAudit(meta: RoleAuditMetadata, originalName: string): boolean {
  return meta.added_keys.length === 0 && meta.removed_keys.length === 0 && Object.keys(meta.scopes).length === 0 && meta.name === originalName;
}
