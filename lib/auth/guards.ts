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

import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole, isOwnerRole } from "@/lib/auth/roles";

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
