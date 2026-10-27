"use server";

import { revalidatePath } from "next/cache";
import { getAnyPermissionAction, getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { canonicalChannels, parseChannels, sameChannels, type ChannelsConfig } from "@/lib/auth/channel-permissions";
import {
  parsePermissions,
  systemRolePermissions,
  type PermissionScope,
  type RolePermissions,
  type ScopedModule,
} from "@/lib/auth/permissions";
import {
  applyKeyToggle,
  canDeleteRole,
  canEditRole,
  describeChannels,
  validateRole,
  type RoleRow,
} from "@/lib/auth/roles-admin";
import { assertCanEditRole, assertCanGrant, grantActorOf } from "@/lib/team/grant";
import { isSameSession, mergeRoleAuditSession, type RoleAuditMetadata } from "@/lib/roles/audit-session";
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
  bookingsScope?: PermissionScope;
  callsScope?: PermissionScope; // @plantilla-quitar(llamadas)
  salesScope?: PermissionScope; // @plantilla-quitar(ventas)
  commissionsScope?: PermissionScope; // @plantilla-quitar(comisiones)
  tasksScope?: PermissionScope; // @plantilla-quitar(tareas)
  /** La bandeja por cuenta (00249). Sin esto, el rol no ve ninguna cuenta. */
  channels?: ChannelsConfig;
}

export async function createRole(
  input: RoleFormInput,
): Promise<RoleActionResult<{ id: string; warnings: string[]; role: RoleRow }>> {
  const ctx = await getPermissionAction("roles.manage");
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar roles" };

  const checked = validateRole({
    name: input.name,
    description: input.description,
    keys: input.keys,
    scopes: { leads: input.leadsScope, bookings: input.bookingsScope, calls: input.callsScope, sales: input.salesScope, commissions: input.commissionsScope, tasks: input.tasksScope }, // @plantilla-quitar(llamadas,ventas,comisiones,tareas)
    // @plantilla-sin(llamadas,ventas,comisiones,tareas): scopes: { leads: input.leadsScope, bookings: input.bookingsScope },
    channels: input.channels ? parseChannels(input.channels) : undefined,
  });
  if (!checked.ok) return checked;

  // No podes dar lo que no tenes: ni claves, ni alcances, ni cuentas de la bandeja mas anchos que los tuyos (lib/team/grant.ts).
  const granted = assertCanGrant(grantActorOf(ctx), {
    keys: checked.role.permissions.keys,
    scopes: checked.role.permissions.scopes,
    channels: { wanted: checked.role.permissions.channels, before: null },
  });
  if (!granted.ok) return { ok: false, error: granted.error };

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
  return {
    ok: true,
    data: {
      id: data.id,
      warnings: checked.role.warnings,
      role: { id: data.id, name: checked.role.name, description: checked.role.description, systemRole: null, permissions: checked.role.permissions, members: 0 },
    },
  };
}

export async function updateRole(
  roleId: string,
  input: RoleFormInput,
): Promise<RoleActionResult<{ warnings: string[] }>> {
  const ctx = await getPermissionAction("roles.manage");
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar roles" };

  const { data: existing } = await ctx.supabase
    .from("workspace_roles")
    .select("id, system_role, permissions")
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
    scopes: { leads: input.leadsScope, bookings: input.bookingsScope, calls: input.callsScope, sales: input.salesScope, commissions: input.commissionsScope, tasks: input.tasksScope }, // @plantilla-quitar(llamadas,ventas,comisiones,tareas)
    // @plantilla-sin(llamadas,ventas,comisiones,tareas): scopes: { leads: input.leadsScope, bookings: input.bookingsScope },
    channels: input.channels ? parseChannels(input.channels) : parsePermissions(existing.permissions).channels,
  });
  if (!checked.ok) return checked;

  // Solo hay que poder dar lo que se AGREGA, y nadie edita el rol que tiene asignado.
  const allowed = assertCanEditRole(
    grantActorOf(ctx),
    { id: existing.id, systemRole: existing.system_role as null, permissions: parsePermissions(existing.permissions) },
    checked.role.permissions,
  );
  if (!allowed.ok) return { ok: false, error: allowed.error };

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
export async function listRoles(): Promise<RoleActionResult<{ roles: RoleRow[]; canManage: boolean }>> {
  // Ver la lista alcanza con `roles.view`; editar exige `roles.manage`.
  const ctx = await getAnyPermissionAction(["roles.view", "roles.manage"]);
  if (!ctx) return { ok: false, error: "No tenes permiso para ver los roles" };

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
      canManage: ctx.can("roles.manage"),
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

// ── Guardado automático (F13) ─────────────────────────────────────────────

export interface RolePatch {
  addKeys?: string[];
  removeKeys?: string[];
  scopes?: Partial<Record<ScopedModule, PermissionScope>>;
  /** La bandeja entera, ya armada por la pantalla (`lib/auth/channel-permissions.ts`). */
  channels?: ChannelsConfig;
  name?: string;
  description?: string | null;
}

/**
 * Un cambio parcial a un rol, para el guardado automatico: tildes, selectores, nombre y descripcion
 * llegan de a uno y devuelven el rol resultante, asi la tarjeta se actualiza en el lugar sin recargar.
 *
 * Las correcciones automaticas (responder implica ver) se aplican igual que en la pantalla. Solo se
 * puede AGREGAR lo que quien edita ya tiene (`assertCanEditRole`), y nadie edita el rol que tiene asignado.
 * Los cambios de una misma persona sobre un mismo rol dentro de 10 minutos quedan en UNA fila del historial.
 */
export async function patchRole(
  roleId: string,
  patch: RolePatch,
): Promise<RoleActionResult<{ role: RoleRow; warnings: string[] }> & { field?: "name" | "description" | "permissions" }> {
  const ctx = await getPermissionAction("roles.manage");
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar roles" };

  const { data: row } = await ctx.supabase
    .from("workspace_roles")
    .select("id, name, description, system_role, permissions")
    .eq("id", roleId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "No encontre ese rol" };

  const editable = canEditRole({ systemRole: row.system_role });
  if (!editable.ok) return editable;

  const current = parsePermissions(row.permissions);
  let keys = current.keys;
  for (const key of patch.removeKeys ?? []) keys = applyKeyToggle(keys, key, false).keys;
  for (const key of patch.addKeys ?? []) keys = applyKeyToggle(keys, key, true).keys;

  const checked = validateRole({
    name: patch.name ?? row.name,
    description: patch.description !== undefined ? patch.description : row.description,
    keys,
    scopes: { ...current.scopes, ...(patch.scopes ?? {}) },
    channels: patch.channels ? parseChannels(patch.channels) : current.channels,
  });
  if (!checked.ok) {
    return { ok: false, error: checked.error, field: patch.name !== undefined ? "name" : patch.description !== undefined ? "description" : "permissions" };
  }

  const allowed = assertCanEditRole(grantActorOf(ctx), { id: row.id, systemRole: null, permissions: current }, checked.role.permissions);
  if (!allowed.ok) return { ok: false, error: allowed.error, field: "permissions" };

  const next = checked.role;
  const update: { name?: string; description?: string | null; permissions?: Json } = {};
  if (next.name !== row.name) update.name = next.name;
  if (next.description !== row.description) update.description = next.description;
  const samePermissions = JSON.stringify(sortedPermissions(current)) === JSON.stringify(sortedPermissions(next.permissions));
  if (!samePermissions) update.permissions = next.permissions as unknown as Json;

  if (Object.keys(update).length > 0) {
    const { error } = await ctx.supabase.from("workspace_roles").update(update).eq("id", roleId);
    if (error) {
      if (error.code === "23505") return { ok: false, error: `Ya hay un rol que se llama "${next.name}"`, field: "name" };
      console.error("[roles] no pude guardar el cambio del rol:", error.message);
      return { ok: false, error: "No pude guardar los cambios" };
    }
    await recordRoleEdit(ctx, row.id, row.name, current, next.permissions, update.name ?? null);
  }

  const { count } = await ctx.supabase
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspace.id)
    .eq("role_id", roleId);

  revalidatePath(ROLES_PATH);
  return {
    ok: true,
    data: {
      warnings: next.warnings,
      role: { id: row.id, name: next.name, description: next.description, systemRole: null, permissions: next.permissions, members: count ?? 0 },
    },
  };
}

const sortedPermissions = (p: RolePermissions) => ({ keys: [...p.keys].sort(), scopes: p.scopes, channels: canonicalChannels(p.channels) });

/**
 * Deja el cambio en el historial, agrupado por sesion de edicion: si esta misma persona ya toco este
 * rol en los ultimos 10 minutos, se suma a esa fila (con service client: el historial no se edita
 * desde el navegador).
 */
async function recordRoleEdit(
  ctx: PermissionContext,
  roleId: string,
  originalName: string,
  before: RolePermissions,
  after: RolePermissions,
  renamedTo: string | null,
) {
  try {
    const addedKeys = after.keys.filter((k) => !before.keys.includes(k));
    const removedKeys = before.keys.filter((k) => !after.keys.includes(k));
    const scopes: Record<string, string> = {};
    for (const [module, value] of Object.entries(after.scopes)) {
      if (before.scopes[module as ScopedModule] !== value) scopes[module] = value;
    }
    // La bandeja no se lista cuenta por cuenta: queda el resumen final ("todas las cuentas (todas)", "2 cuentas").
    if (!sameChannels(before.channels, after.channels)) scopes.bandeja = describeChannels(after.channels);
    const now = new Date();
    const service = await createServiceClient();

    const { data: recent } = await service
      .from("audit_log")
      .select("id, performed_at, performed_by, metadata")
      .eq("workspace_id", ctx.workspace.id)
      .eq("entity_type", "channel")
      .eq("action", "update")
      .eq("performed_by", ctx.user.id)
      .order("performed_at", { ascending: false })
      .limit(20);

    const previous = (recent ?? []).find((r) => {
      const meta = r.metadata as Partial<RoleAuditMetadata> | null;
      return meta?.kind === "role_updated" && isSameSession({ performedAt: r.performed_at, performedBy: r.performed_by, metadata: meta }, now, ctx.user.id, roleId);
    });

    const prevMeta = previous ? (previous.metadata as Partial<RoleAuditMetadata>) : null;
    const merged = mergeRoleAuditSession(prevMeta, roleId, originalName, { addedKeys, removedKeys, scopes, renamedTo });

    if (previous) {
      await service
        .from("audit_log")
        .update({ metadata: merged, performed_at: now.toISOString() } as never)
        .eq("id", previous.id);
    } else {
      await logAudit({
        supabase: ctx.supabase,
        workspaceId: ctx.workspace.id,
        entityType: "channel",
        entityId: ctx.workspace.id,
        action: "update",
        metadata: merged as unknown as Record<string, Json>,
        performedBy: ctx.user.id,
      });
    }
  } catch (err) {
    // El historial es evidencia, no una precondicion: un fallo aca no deshace el guardado.
    console.error("[roles] no pude anotar el cambio del rol:", err instanceof Error ? err.message : "error");
  }
}
