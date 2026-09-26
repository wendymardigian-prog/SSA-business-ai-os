"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import {
  parsePermissions,
  systemRolePermissions,
  type PermissionScope,
} from "@/lib/auth/permissions";
import {
  canDeleteRole,
  canEditRole,
  validateRole,
  type RoleRow,
} from "@/lib/auth/roles-admin";
import type { Json } from "@/lib/types/database";

/**
 * Crear, editar y borrar roles (F71).
 *
 * Todo cambio queda en `audit_log`: un rol es un permiso, y despues nadie se
 * acuerda quien le dio a quien la posibilidad de publicar.
 *
 * Los roles de sistema los frena el trigger de la base igual, pero se
 * rechazan antes para dar un mensaje que se entienda en vez de un error de
 * Postgres.
 */

const ROLES_PATH = "/dashboard/settings/roles";

export type RoleActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

export interface RoleFormInput {
  name: string;
  description?: string | null;
  keys: string[];
  leadsScope?: PermissionScope;
  conversationsScope?: PermissionScope;
}

export async function createRole(
  input: RoleFormInput,
): Promise<RoleActionResult<{ id: string; warnings: string[] }>> {
  const ctx = await getPermissionAction("roles.manage");
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar roles" };

  const checked = validateRole({
    name: input.name,
    description: input.description,
    keys: input.keys,
    scopes: { leads: input.leadsScope, conversations: input.conversationsScope },
  });
  if (!checked.ok) return checked;

  const { data, error } = await ctx.supabase
    .from("workspace_roles")
    .insert({
      workspace_id: ctx.workspace.id,
      name: checked.role.name,
      description: checked.role.description,
      permissions: checked.role.permissions as unknown as Json,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, error: `Ya hay un rol que se llama "${checked.role.name}"` };
    }
    console.error("[roles] no pude crear el rol:", error?.message);
    return { ok: false, error: "No pude crear el rol" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "create",
    // El nombre y la cantidad de permisos: no las claves una por una, que
    // harian un log ilegible.
    metadata: { kind: "role_created", name: checked.role.name, permissions: checked.role.permissions.keys.length },
    performedBy: ctx.user.id,
  });

  revalidatePath(ROLES_PATH);
  return { ok: true, data: { id: data.id, warnings: checked.role.warnings } };
}

export async function updateRole(
  roleId: string,
  input: RoleFormInput,
): Promise<RoleActionResult<{ warnings: string[] }>> {
  const ctx = await getPermissionAction("roles.manage");
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar roles" };

  const { data: existing } = await ctx.supabase
    .from("workspace_roles")
    .select("id, system_role")
    .eq("id", roleId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();

  if (!existing) return { ok: false, error: "No encontre ese rol" };

  const editable = canEditRole({ systemRole: existing.system_role });
  if (!editable.ok) return editable;

  const checked = validateRole({
    name: input.name,
    description: input.description,
    keys: input.keys,
    scopes: { leads: input.leadsScope, conversations: input.conversationsScope },
  });
  if (!checked.ok) return checked;

  const { error } = await ctx.supabase
    .from("workspace_roles")
    .update({
      name: checked.role.name,
      description: checked.role.description,
      permissions: checked.role.permissions as unknown as Json,
    })
    .eq("id", roleId);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Ya hay un rol que se llama "${checked.role.name}"` };
    }
    console.error("[roles] no pude actualizar el rol:", error.message);
    return { ok: false, error: "No pude guardar los cambios" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "update",
    metadata: { kind: "role_updated", name: checked.role.name, permissions: checked.role.permissions.keys.length },
    performedBy: ctx.user.id,
  });

  revalidatePath(ROLES_PATH);
  return { ok: true, data: { warnings: checked.role.warnings } };
}

export async function deleteRole(roleId: string): Promise<RoleActionResult> {
  const ctx = await getPermissionAction("roles.manage");
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar roles" };

  const { data: role } = await ctx.supabase
    .from("workspace_roles")
    .select("id, name, system_role")
    .eq("id", roleId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();

  if (!role) return { ok: false, error: "No encontre ese rol" };

  // Cuanta gente lo tiene: se cuenta ANTES de intentar borrar, para poder
  // decir cuantas son en vez de un error de llave foranea.
  const { count } = await ctx.supabase
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspace.id)
    .eq("role_id", roleId);

  const deletable = canDeleteRole({
    systemRole: role.system_role,
    members: count ?? 0,
    name: role.name,
  });
  if (!deletable.ok) return deletable;

  const { error } = await ctx.supabase.from("workspace_roles").delete().eq("id", roleId);

  if (error) {
    console.error("[roles] no pude borrar el rol:", error.message);
    return { ok: false, error: "No pude borrar el rol" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "delete",
    metadata: { kind: "role_deleted", name: role.name },
    performedBy: ctx.user.id,
  });

  revalidatePath(ROLES_PATH);
  return { ok: true };
}

/** Los roles del workspace con cuanta gente tiene cada uno (F71). */
export async function listRoles(): Promise<RoleActionResult<{ roles: RoleRow[] }>> {
  const ctx = await getPermissionAction("roles.manage");
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar roles" };

  const [{ data: roles }, { data: members }] = await Promise.all([
    ctx.supabase
      .from("workspace_roles")
      .select("id, name, description, system_role, permissions")
      .eq("workspace_id", ctx.workspace.id),
    ctx.supabase
      .from("workspace_members")
      .select("role_id")
      .eq("workspace_id", ctx.workspace.id),
  ]);

  const counts = new Map<string, number>();
  for (const member of members ?? []) {
    if (member.role_id) counts.set(member.role_id, (counts.get(member.role_id) ?? 0) + 1);
  }

  return {
    ok: true,
    data: {
      roles: (roles ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        systemRole: row.system_role,
        // Los de sistema muestran los permisos de la TABLA, no el jsonb: la
        // fila los tiene vacios a proposito, y la pantalla tiene que mostrar
        // lo que un Owner puede de verdad.
        permissions: row.system_role
          ? (systemRolePermissions(row.system_role) ?? parsePermissions(row.permissions))
          : parsePermissions(row.permissions),
        members: counts.get(row.id) ?? 0,
      })),
    },
  };
}
