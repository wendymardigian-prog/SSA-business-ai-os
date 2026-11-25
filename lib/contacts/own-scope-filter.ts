import type { PermissionContext } from "@/lib/auth/guards";

/** Lo que el filtro necesita del contexto de permisos (así se prueba sin la sesión). */
export type OwnScopeContext = Pick<PermissionContext, "role" | "scope"> & { user: { id: string } };

/**
 * Filtro PostgREST (`.or(...)`) con los contactos borrados que la persona puede ver o restaurar cuando se leen con el
 * cliente de servicio: la RLS esconde lo borrado, así que el alcance se aplica a mano. Misma regla de setter y
 * vendedor que `can_see_contact` (más estricta: no suma los chats asignados ni los servicios a cargo). `null` = ve todo
 * (Owner, Admin o alcance «all»). El id sale de la sesión: es un uuid, no hay texto del navegador en el filtro.
 */
export function ownContactsFilter(ctx: OwnScopeContext): string | null {
  if (ctx.role === "owner" || ctx.role === "admin" || ctx.scope("leads") === "all") return null;
  const me = ctx.user.id;
  const own = `setter_id.eq.${me},vendedor_id.eq.${me}`;
  return ctx.scope("leads") === "own_unassigned" ? `${own},and(setter_id.is.null,vendedor_id.is.null)` : own;
}
