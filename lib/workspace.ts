import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const WORKSPACE_COOKIE = "workspace_id";
/** Nombre viejo (hasta el white label): se sigue leyendo como respaldo para no perder la seleccion de quien ya tenia la cookie puesta. */
const LEGACY_WORKSPACE_COOKIE = "zernflow_workspace_id";

/**
 * Cached per-request: deduplicates across layout + page in the same render.
 * Reads workspace ID from cookie if set; falls back to first workspace.
 */
export const getWorkspace = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value ?? cookieStore.get(LEGACY_WORKSPACE_COOKIE)?.value;

  // Try cookie workspace first
  if (selectedId) {
    const { data: membership } = await supabase
      .from("workspace_members")
      // role_id se suma en la etapa 2: es el rol con los permisos finos
      // (00088). `role` sigue siendo owner/admin/member y es lo que leen las
      // policies que ya existian.
      .select("workspace_id, role, role_id, workspaces(*)")
      .eq("user_id", user.id)
      .eq("workspace_id", selectedId)
      .single();

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

  // Fallback to first workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, role_id, workspaces(*)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership?.workspaces) redirect("/login");

  return {
    user,
    workspace: membership.workspaces,
    role: membership.role,
    roleId: membership.role_id,
    supabase,
  };
});
