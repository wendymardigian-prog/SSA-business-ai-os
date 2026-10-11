/**
 * Guards de rol para paginas, API routes y server actions. Solo servidor.
 *
 * La RLS de la base es la barrera real (migracion 00018): aunque alguien se
 * saltee estos guards, la base no le devuelve datos ni le acepta escrituras.
 * Esto existe para que la app no muestre pantallas que el usuario no puede
 * usar y para devolver un 403 claro en las API routes.
 *
 * Los helpers puros (isAdminRole, ROLE_LABELS, ...) estan en lib/auth/roles.ts
 * para que tambien los pueda usar un Client Component.
 */

import { cache } from "react";
import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole, isOwnerRole } from "@/lib/auth/roles";
import {
  can,
  parsePermissions,
  scopeFor,
  systemRolePermissions,
  type PermissionScope,
  type RolePermissions,
  type ScopedModule,
} from "@/lib/auth/permissions";

export * from "@/lib/auth/roles";

/**
 * Para paginas: exige Owner o Admin, o manda al dashboard.
 * Devuelve el mismo contexto que getWorkspace, asi la pagina no lo pide dos
 * veces (getWorkspace esta cacheado por request).
 */
export async function requireWorkspaceAdmin() {
  const ctx = await getWorkspace();
  if (!isAdminRole(ctx.role)) redirect("/dashboard");
  return ctx;
}

/** Para paginas: exige Owner. */
export async function requireWorkspaceOwner() {
  const ctx = await getWorkspace();
  if (!isOwnerRole(ctx.role)) redirect("/dashboard");
  return ctx;
}

/**
 * Para API routes y server actions: no redirige, devuelve el contexto o null.
 * El llamador decide el status (401 vs 403).
 */
export async function getAdminContext() {
  const ctx = await getWorkspace();
  return isAdminRole(ctx.role) ? ctx : null;
}

// ── Permisos (F70) ────────────────────────────────────────────────────────
//
// `requireWorkspaceAdmin` y `getAdminContext` NO cambian de comportamiento:
// para Owner y Admin siguen diciendo lo mismo, porque los dos tienen todos
// los permisos. Lo que se suma es una forma mas fina de preguntar, para las
// pantallas y acciones donde un rol personalizado puede entrar.

export interface PermissionContext {
  workspace: Awaited<ReturnType<typeof getWorkspace>>["workspace"];
  user: Awaited<ReturnType<typeof getWorkspace>>["user"];
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"];
  role: string;
  permissions: RolePermissions;
  /** Atajo: `can(permissions, key)`. */
  can: (key: string) => boolean;
  scope: (module: ScopedModule) => PermissionScope;
}

/**
 * El contexto con los permisos resueltos.
 *
 * Los de Owner y Admin salen de `SYSTEM_ROLE_PERMISSIONS` y no de la base:
 * son la fuente, y leer el jsonb para ellos daria dos lugares donde definir
 * lo mismo. Solo un `member` con `role_id` lee su fila.
 *
 * `cache()`: el layout, la pagina y los layouts intermedios lo piden en el
 * mismo render; se resuelve una vez por request.
 */
export const getPermissionContext = cache(async (): Promise<PermissionContext> => {
  const ctx = await getWorkspace();

  let permissions = systemRolePermissions(ctx.role);

  // Un member con rol personalizado: sus permisos estan en la fila.
  if (ctx.role === "member" && ctx.roleId) {
    const { data: row } = await ctx.supabase
      .from("workspace_roles")
      .select("system_role, permissions")
      .eq("id", ctx.roleId)
      .maybeSingle();

    // Si la fila es el rol de sistema "Member", sus permisos son los de la
    // tabla de TypeScript (la fila los tiene vacios a proposito).
    if (row && !row.system_role) permissions = parsePermissions(row.permissions);
  }

  const resolved = permissions ?? systemRolePermissions("member")!;

  return {
    workspace: ctx.workspace,
    user: ctx.user,
    supabase: ctx.supabase,
    role: ctx.role,
    permissions: resolved,
    can: (key: string) => can(resolved, key),
    scope: (module: ScopedModule) => scopeFor(resolved, module),
  };
});

/**
 * Para paginas: exige un permiso, o manda al dashboard.
 *
 * No muestra un 403: lleva al dashboard, que es lo que la persona SI puede
 * ver. Una pantalla de error para algo que nunca va a poder abrir es un
 * callejon.
 */
export async function requirePermission(key: string): Promise<PermissionContext> {
  const ctx = await getPermissionContext();
  if (!ctx.can(key)) redirect("/dashboard");
  return ctx;
}

/**
 * Para rutas y Server Actions que cualquier MIEMBRO puede usar, sin un permiso
 * aparte (conectar el propio Fathom, decision 153). Devuelve el contexto con
 * los permisos resueltos, o null si no hay sesion o membresia.
 *
 * No existe un "guard de miembro" mas barato: `getWorkspace` ya manda al login
 * si no hay usuario o membresia. Esto solo da una salida con null para los
 * lugares que prefieren responder 403 a redirigir.
 */
export async function getMemberAction(): Promise<PermissionContext | null> {
  try {
    return await getPermissionContext();
  } catch {
    return null;
  }
}

/**
 * Para Server Actions y rutas: devuelve el contexto o null.
 *
 * Null y no una excepcion: quien llama decide el mensaje, y una accion que
 * responde "sin permiso" es mas util que una que tira un error.
 */
export async function getPermissionAction(key: string): Promise<PermissionContext | null> {
  const ctx = await getPermissionContext();
  return ctx.can(key) ? ctx : null;
}
