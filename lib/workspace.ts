import { cache } from "react";
import { cookies } from "next/headers";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { redirect } from "next/navigation";

export const WORKSPACE_COOKIE = "workspace_id";

/**
 * El workspace activo de quien esta logueado, o null si no hay sesion o no es
 * miembro de ninguno. NO redirige: lo usan tambien las API Routes, que
 * responden 401/404 en vez de mandar al login.
 *
 * Una persona puede ser miembro de varios workspaces (un mismo dueño con dos
 * negocios en la misma instalacion): el activo es el de la cookie
 * `workspace_id`, si sigue siendo miembro; si no, el MAS VIEJO de sus
 * workspaces (orden por `created_at` de la membresia). Nunca "cualquiera":
 * sin orden, dos pedidos seguidos podian caer en negocios distintos.
 *
 * Toda pantalla, accion o ruta que necesite el workspace sale de aca (o de
 * `getWorkspace`): `lib/workspace-boundary.test.ts` falla si una ruta vuelve a
 * buscarlo por su cuenta con `.limit(1)`.
 *
 * Cacheado por request: el layout, la pagina y los guards comparten una
 * sola consulta.
 */
export const getActiveWorkspace = cache(async () => {
  // Sin viaje a Supabase Auth: ver `getAuthUser`.
  const { supabase, user } = await getAuthUser();
  if (!user) return null;

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;

  // Primero el workspace elegido (cookie), si la persona sigue siendo miembro.
  if (selectedId) {
    const { data: membership } = await supabase
      .from("workspace_members")
      // role_id se suma en la etapa 2: es el rol con los permisos finos
      // (00088). `role` sigue siendo owner/admin/member y es lo que leen las
      // policies que ya existian.
      .select("workspace_id, role, role_id, workspaces(*)")
      .eq("user_id", user.id)
      .eq("workspace_id", selectedId)
      .maybeSingle();

    if (membership?.workspaces) {
      return {
        user,
        workspace: membership.workspaces,
        role: membership.role,
        roleId: membership.role_id,
        supabase,
      };
    }
  }

  // Sin cookie (o con una que ya no vale): el workspace mas viejo de la persona.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, role_id, workspaces(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .order("workspace_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.workspaces) return null;

  return {
    user,
    workspace: membership.workspaces,
    role: membership.role,
    roleId: membership.role_id,
    supabase,
  };
});

/**
 * Lo mismo que `getActiveWorkspace`, para pantallas y Server Actions: sin
 * sesion o sin workspace, al login.
 */
export const getWorkspace = cache(async () => {
  const active = await getActiveWorkspace();
  if (!active) redirect("/login");
  return active;
});

/**
 * Deja `workspaceId` como el workspace activo de este navegador (cookie
 * httpOnly de un año). Solo para Server Actions y Route Handlers, despues de
 * comprobar que la persona es miembro: la cookie no da acceso a nada por si
 * sola (`getActiveWorkspace` la vuelve a validar contra la membresia).
 */
export async function setActiveWorkspaceCookie(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}
