"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { ASSIGNABLE_ROLES, isAdminRole, ROLE_LABELS, type WorkspaceRole } from "@/lib/auth/roles";
import { sendTransactionalEmail } from "@/lib/email/send";
import { teamInviteEmail } from "@/lib/email/templates";
import { inviteUrl } from "@/lib/app-url";
import { logAudit } from "@/lib/audit";
import { getPermissionAction } from "@/lib/auth/guards";

/**
 * Como termino el email de la invitacion.
 * - "sent": salio por Resend.
 * - "not_configured": Resend no esta conectado. La invitacion igual existe:
 *   la UI muestra el link para pasarlo a mano. Es el estado normal hoy.
 * - "failed": Resend esta conectado pero rechazo el envio.
 */
export type InviteEmailStatus = "sent" | "not_configured" | "failed";

export async function inviteTeamMember(
  workspaceId: string,
  email: string,
  role: string
) {
  const { workspace, user, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "El workspace no coincide" };
  }

  // Validate caller is owner or admin
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!isAdminRole(membership?.role)) {
    return { error: "Solo Owner y Admin pueden invitar miembros" };
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return { error: "Hace falta un email válido" };
  }

  if (!ASSIGNABLE_ROLES.includes(role as WorkspaceRole)) {
    return { error: "Rol invalido. Tiene que ser member o admin." };
  }

  // Check if this email is already a member
  const { data: existingMembers } = await supabase
    .from("workspace_members")
    .select("user_id, workspaces!inner(id)")
    .eq("workspace_id", workspaceId);

  if (existingMembers && existingMembers.length > 0) {
    // We need to check auth.users for the email, but RLS won't let us.
    // Instead, check if there's already a pending invite for this email.
    const { data: existingInvite } = await supabase
      .from("workspace_invites")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("email", trimmedEmail)
      .eq("status", "pending")
      .single();

    if (existingInvite) {
      return { error: "Ya hay una invitación pendiente para ese email" };
    }
  }

  const { data: invite, error: insertError } = await supabase
    .from("workspace_invites")
    .insert({
      workspace_id: workspaceId,
      email: trimmedEmail,
      role,
      invited_by: user.id,
      status: "pending",
    })
    .select("*")
    .single();

  if (insertError) {
    return { error: insertError.message };
  }

  // El email es best-effort: la invitacion ya existe y el link sirve igual.
  // Si Resend no esta conectado, la UI muestra el link para pasarlo a mano.
  const url = inviteUrl(invite.id);
  const content = teamInviteEmail({
    workspaceName: workspace.name,
    inviteUrl: url,
    roleLabel: ROLE_LABELS[role as WorkspaceRole] ?? role,
  });

  const sent = await sendTransactionalEmail({
    workspaceId,
    to: trimmedEmail,
    subject: content.subject,
    html: content.html,
    kind: "team_invite",
    relatedEntityType: "workspace_invite",
    relatedEntityId: invite.id,
    createdBy: user.id,
  });

  const emailStatus: InviteEmailStatus = sent.ok
    ? "sent"
    : sent.reason === "not_configured"
      ? "not_configured"
      : "failed";

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "workspace_member", entityId: invite.id,
    action: "create",
    metadata: { stage: "invite", email: trimmedEmail, role: invite.role, email_status: emailStatus },
    performedBy: user.id,
  });

  return { ok: true, invite, inviteUrl: url, emailStatus, emailError: sent.ok ? null : sent.error };
}

export async function removeTeamMember(
  workspaceId: string,
  userId: string
) {
  const { workspace, user, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "El workspace no coincide" };
  }

  // Validate caller is owner
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (membership?.role !== "owner") {
    return { error: "Solo el Owner puede quitar miembros" };
  }

  // Can't remove yourself
  if (userId === user.id) {
    return { error: "No podés quitarte a vos mismo del workspace" };
  }

  const { error: deleteError } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  // La entidad es la persona que se fue: es lo que se va a querer buscar
  // cuando alguien pregunte por que un lead quedo sin dueño.
  await logAudit({
    supabase, workspaceId, entityType: "workspace_member", entityId: userId,
    action: "delete", performedBy: user.id,
  });

  return { ok: true };
}

export async function acceptInvite(inviteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  // Use service client to bypass RLS (the user is not a workspace member yet)
  const serviceClient = await createServiceClient();

  // Fetch the invite
  const { data: invite, error: fetchError } = await serviceClient
    .from("workspace_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (fetchError || !invite) {
    return { error: "No encontré esa invitación" };
  }

  if (invite.status !== "pending") {
    return { error: "Esta invitación ya no es válida" };
  }

  if (new Date(invite.expires_at) < new Date()) {
    return { error: "Esta invitación venció" };
  }

  // Verify the invite email matches the current user's email
  if (invite.email !== user.email) {
    return { error: "Esta invitación se mandó a otro email" };
  }

  // Check if user is already a member
  const { data: existingMembership } = await serviceClient
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", user.id)
    .single();

  if (existingMembership) {
    // Already a member, just mark the invite as accepted
    await serviceClient
      .from("workspace_invites")
      .update({ status: "accepted" })
      .eq("id", inviteId);

    return { ok: true, workspaceId: invite.workspace_id, alreadyMember: true };
  }

  // Insert into workspace_members (service client bypasses owner-only RLS)
  const { error: insertError } = await serviceClient
    .from("workspace_members")
    .insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
    });

  if (insertError) {
    return { error: insertError.message };
  }

  // Update invite status to accepted
  await serviceClient
    .from("workspace_invites")
    .update({ status: "accepted" })
    .eq("id", inviteId);

  return { ok: true, workspaceId: invite.workspace_id };
}

export async function revokeInvite(inviteId: string) {
  const { user, supabase } = await getWorkspace();

  // Fetch the invite to get workspace_id
  const { data: invite, error: fetchError } = await supabase
    .from("workspace_invites")
    .select("workspace_id")
    .eq("id", inviteId)
    .single();

  if (fetchError || !invite) {
    return { error: "No encontré esa invitación" };
  }

  // Validate caller is owner or admin
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", user.id)
    .single();

  if (!isAdminRole(membership?.role)) {
    return { error: "Solo Owner y Admin pueden revocar invitaciones" };
  }

  const { error: deleteError } = await supabase
    .from("workspace_invites")
    .delete()
    .eq("id", inviteId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  await logAudit({
    supabase, workspaceId: invite.workspace_id, entityType: "workspace_member", entityId: inviteId,
    action: "delete", metadata: { stage: "invite_revoked" }, performedBy: user.id,
  });

  return { ok: true };
}

/**
 * Cambia el rol de un miembro entre admin y member.
 *
 * Reglas (las mismas que aplica la RLS de la migracion 00018, repetidas aca
 * para poder devolver un mensaje claro en vez de un error de base):
 * - Solo Owner o Admin pueden cambiar roles.
 * - A owner no se llega por esta via: se es owner por crear el workspace.
 * - Un Admin no puede tocar la fila de un Owner (si no, se auto-promoveria
 *   degradando al owner primero).
 * - Nadie cambia su propio rol.
 */
export async function changeMemberRole(
  workspaceId: string,
  userId: string,
  newRole: string
) {
  const { workspace, user, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "El workspace no coincide" };
  }

  if (!ASSIGNABLE_ROLES.includes(newRole as WorkspaceRole)) {
    return { error: "Rol invalido. Tiene que ser member o admin." };
  }

  if (userId === user.id) {
    return { error: "No podes cambiar tu propio rol" };
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!isAdminRole(membership?.role)) {
    return { error: "Solo Owner y Admin pueden cambiar roles" };
  }

  // El rol del target lo leemos con el service client: la policy de SELECT de
  // workspace_members solo devuelve la fila propia.
  const serviceClient = await createServiceClient();
  const { data: target } = await serviceClient
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .single();

  if (!target) {
    return { error: "Ese miembro no pertenece al workspace" };
  }

  if (target.role === "owner") {
    return { error: "No se puede cambiar el rol del Owner del workspace" };
  }

  if (target.role === newRole) {
    return { ok: true, role: newRole };
  }

  const { error: updateError } = await supabase
    .from("workspace_members")
    .update({ role: newRole })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (updateError) {
    return { error: updateError.message };
  }

  await logAudit({
    supabase, workspaceId, entityType: "workspace_member", entityId: userId,
    action: "update",
    changes: { role: { old: target.role, new: newRole } },
    performedBy: user.id,
  });

  return { ok: true, role: newRole };
}

/**
 * Cambiar el rol de una persona del equipo (F72).
 *
 * Dos reglas:
 *
 * 1. **`role` sigue siendo owner/admin/member.** Un rol personalizado es
 *    siempre un `member` con permisos de mas: asi las cuarenta policies que
 *    leen `role` no cambian de comportamiento. Lo que cambia es `role_id`.
 * 2. **No se puede quedar sin Owner.** Es la unica persona que puede
 *    transferir la propiedad y recuperar el workspace si algo sale mal.
 */
export async function setMemberRole(input: {
  userId: string;
  /** El id de un rol del workspace (de sistema o personalizado). */
  roleId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("team.manage");
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar el equipo" };

  const [{ data: role }, { data: member }] = await Promise.all([
    ctx.supabase
      .from("workspace_roles")
      .select("id, name, system_role")
      .eq("id", input.roleId)
      .eq("workspace_id", ctx.workspace.id)
      .maybeSingle(),
    ctx.supabase
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", ctx.workspace.id)
      .eq("user_id", input.userId)
      .maybeSingle(),
  ]);

  if (!role) return { ok: false, error: "No encontre ese rol" };
  if (!member) return { ok: false, error: "Esa persona no esta en el equipo" };

  // El rol base: los personalizados son siempre `member`.
  const baseRole = role.system_role ?? "member";

  // Sacarle el Owner al ultimo Owner deja el workspace sin quien pueda
  // transferirlo ni recuperarlo.
  if (member.role === "owner" && baseRole !== "owner") {
    const { count } = await ctx.supabase
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .eq("role", "owner");

    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        error: "Es el unico Owner del negocio. Nombra a otro Owner antes de cambiarle el rol.",
      };
    }
  }

  const { error } = await ctx.supabase
    .from("workspace_members")
    .update({ role: baseRole, role_id: role.id })
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", input.userId);

  if (error) {
    console.error("[equipo] no pude cambiar el rol:", error.message);
    return { ok: false, error: "No pude cambiar el rol" };
  }

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: ctx.workspace.id,
    action: "update",
    // El id de la persona, no su email: el log no lleva PII de mas.
    metadata: { kind: "member_role_changed", user_id: input.userId, role: role.name },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/settings/team");
  return { ok: true };
}
