"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { ASSIGNABLE_ROLES, isAdminRole, type WorkspaceRole } from "@/lib/auth/roles";

export async function inviteTeamMember(
  workspaceId: string,
  email: string,
  role: string
) {
  const { workspace, user, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "Workspace mismatch" };
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
    return { error: "A valid email address is required" };
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
      return { error: "An invite for this email is already pending" };
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

  return { ok: true, invite };
}

export async function removeTeamMember(
  workspaceId: string,
  userId: string
) {
  const { workspace, user, supabase } = await getWorkspace();

  if (workspace.id !== workspaceId) {
    return { error: "Workspace mismatch" };
  }

  // Validate caller is owner
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (membership?.role !== "owner") {
    return { error: "Only workspace owners can remove members" };
  }

  // Can't remove yourself
  if (userId === user.id) {
    return { error: "You cannot remove yourself from the workspace" };
  }

  const { error: deleteError } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  return { ok: true };
}

export async function acceptInvite(inviteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated" };

  // Use service client to bypass RLS (the user is not a workspace member yet)
  const serviceClient = await createServiceClient();

  // Fetch the invite
  const { data: invite, error: fetchError } = await serviceClient
    .from("workspace_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (fetchError || !invite) {
    return { error: "Invite not found" };
  }

  if (invite.status !== "pending") {
    return { error: "This invite is no longer valid" };
  }

  if (new Date(invite.expires_at) < new Date()) {
    return { error: "This invite has expired" };
  }

  // Verify the invite email matches the current user's email
  if (invite.email !== user.email) {
    return { error: "This invite was sent to a different email address" };
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
    return { error: "Invite not found" };
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
    return { error: "Workspace mismatch" };
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

  return { ok: true, role: newRole };
}
