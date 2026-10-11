"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getWorkspace } from "@/lib/workspace";
import { ASSIGNABLE_ROLES, isAdminRole, ROLE_LABELS, type WorkspaceRole } from "@/lib/auth/roles";
import { sendTransactionalEmail } from "@/lib/email/send";
import { teamInviteEmail } from "@/lib/email/templates";
import { inviteUrl } from "@/lib/app-url";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import { getPermissionAction } from "@/lib/auth/guards";
import { validateCloserEmails } from "@/lib/fathom/closers";
import { revokeFathomConnectionsOf } from "@/lib/fathom/revoke";
import { memberDisplayName } from "@/lib/workspace-members";

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
      // Una vencida no cuenta: sigue en 'pending' (nada la pasa a otro
      // estado), y sin este filtro bloqueaba volver a invitar a esa persona.
      .gt("expires_at", new Date().toISOString())
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

  // Llamadas: su Fathom se desconecta con la persona (sus llamadas quedan, son
  // del negocio). Un paso posterior y aparte: si falla, salir del equipo ya paso.
  try {
    await revokeFathomConnectionsOf(await createServiceClient(), workspaceId, userId);
  } catch (err) {
    console.error("[equipo] no pude revocar el Fathom de quien salió:", err instanceof Error ? err.message : "error");
  }

  return { ok: true };
}

type ServiceClient = ReturnType<typeof createServiceClient> extends Promise<infer T> ? T : never;
/** Fila cruda de workspace_invites (select("*")): no hay un tipo generado aparte. */
type InviteRow = Record<string, unknown> & { id: string; workspace_id: string; email: string; role: string; status: string; expires_at: string };

/**
 * Las tres validaciones que tiene que pasar una invitacion para poder
 * aceptarse, tanto si quien acepta ya tiene cuenta (`acceptInvite`) como si
 * se la crea en el momento (`registerFromInvite`).
 */
async function validatePendingInvite(
  serviceClient: ServiceClient,
  inviteId: string,
  expectedEmail?: string
): Promise<{ ok: true; invite: InviteRow } | { ok: false; error: string }> {
  const { data: invite, error: fetchError } = await serviceClient
    .from("workspace_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (fetchError || !invite) {
    return { ok: false, error: "No encontré esa invitación" };
  }
  if (invite.status !== "pending") {
    return { ok: false, error: "Esta invitación ya no es válida" };
  }
  if (new Date(invite.expires_at) < new Date()) {
    return { ok: false, error: "Esta invitación venció" };
  }
  if (expectedEmail && invite.email !== expectedEmail) {
    return { ok: false, error: "Esta invitación se mandó a otro email" };
  }
  return { ok: true, invite };
}

/** Suma al workspace y marca la invitacion aceptada. Service client: bypassea la RLS de owner-only sobre workspace_members. */
async function finalizeAcceptInvite(serviceClient: ServiceClient, invite: InviteRow, userId: string) {
  const { data: existingMembership } = await serviceClient
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", userId)
    .single();

  if (existingMembership) {
    await serviceClient.from("workspace_invites").update({ status: "accepted" }).eq("id", invite.id);
    return { ok: true as const, workspaceId: invite.workspace_id, alreadyMember: true };
  }

  const { error: insertError } = await serviceClient.from("workspace_members").insert({
    workspace_id: invite.workspace_id,
    user_id: userId,
    role: invite.role,
  });

  if (insertError) {
    return { ok: false as const, error: insertError.message };
  }

  await serviceClient.from("workspace_invites").update({ status: "accepted" }).eq("id", invite.id);
  return { ok: true as const, workspaceId: invite.workspace_id };
}

export async function acceptInvite(inviteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  // Use service client to bypass RLS (the user is not a workspace member yet)
  const serviceClient = await createServiceClient();

  const validation = await validatePendingInvite(serviceClient, inviteId, user.email);
  if (!validation.ok) return { error: validation.error };

  return finalizeAcceptInvite(serviceClient, validation.invite, user.id);
}

/**
 * Crea la cuenta y acepta la invitacion en un solo paso: es el unico lugar
 * donde alguien puede registrarse (no hay `/register` publico). El email
 * viene fijo de la invitacion, nunca del formulario.
 *
 * `email_confirm: true` porque el link ya llego a ese correo: pedirle que
 * confirme de nuevo es un paso de mas.
 */
export async function registerFromInvite(inviteId: string, fullName: string, password: string) {
  const name = fullName.trim();
  if (!name) return { error: "Ingresá tu nombre" };
  if (password.length < 6) return { error: "La contraseña tiene que tener al menos 6 caracteres" };

  const serviceClient = await createServiceClient();
  const validation = await validatePendingInvite(serviceClient, inviteId);
  if (!validation.ok) return { error: validation.error };
  const invite = validation.invite;

  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, invite_id: invite.id },
  });

  if (createError || !created?.user) {
    if (/already|existe|registrad/i.test(createError?.message ?? "")) {
      return { error: "Ya existe una cuenta con ese email. Iniciá sesión.", alreadyRegistered: true };
    }
    return { error: createError?.message || "No se pudo crear la cuenta" };
  }

  // El service client no tiene cookies: inicia sesion con el cliente normal
  // para que la sesion quede guardada en el navegador de quien se registra.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: invite.email, password });
  if (signInError) {
    return {
      error: "Tu cuenta se creó. Iniciá sesión con tu email y tu contraseña para aceptar la invitación.",
      alreadyRegistered: true,
    };
  }

  return finalizeAcceptInvite(serviceClient, invite, created.user.id);
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

/**
 * Marcar a una persona como closer y cargar sus correos alternos (F4).
 *
 * Solo las llamadas de quien esta marcado entran desde Fathom. Un correo no
 * puede ser de dos personas: ni el de la cuenta de otra ni un alterno de otra.
 * Apagar la marca no toca las llamadas ya guardadas; solo frena las nuevas.
 */
export async function setMemberCloser(input: {
  userId: string;
  isCloser: boolean;
  closerEmails: string[];
}): Promise<{ ok: true; emails: string[] } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("team.manage");
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar el equipo" };

  const service = await createServiceClient();
  const [{ data: profiles }, { data: rows }] = await Promise.all([
    service.rpc("workspace_member_profiles", { p_workspace_id: ctx.workspace.id }),
    service.from("workspace_members").select("user_id, is_closer, closer_emails").eq("workspace_id", ctx.workspace.id),
  ]);

  const target = (rows ?? []).find((r) => r.user_id === input.userId);
  if (!target) return { ok: false, error: "Esa persona no esta en el equipo" };

  const byUser = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  const others = (rows ?? []).map((r) => {
    const p = byUser.get(r.user_id);
    return {
      userId: r.user_id,
      name: memberDisplayName(p?.full_name, p?.meta_name, p?.email),
      email: p?.email ?? null,
      closerEmails: r.closer_emails ?? [],
    };
  });

  const checked = validateCloserEmails(input.userId, input.closerEmails, others);
  if (!checked.ok) return checked;

  const { error } = await service
    .from("workspace_members")
    .update({ is_closer: input.isCloser, closer_emails: checked.emails })
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", input.userId);
  if (error) {
    console.error("[equipo] no pude guardar la marca de closer:", error.message);
    return { ok: false, error: "No pude guardar los cambios" };
  }

  const changes: Record<string, { old: Json; new: Json }> = {};
  if (target.is_closer !== input.isCloser) changes.is_closer = { old: target.is_closer, new: input.isCloser };
  const before = (target.closer_emails ?? []).join(",");
  if (before !== checked.emails.join(",")) changes.closer_emails = { old: target.closer_emails ?? [], new: checked.emails };

  if (Object.keys(changes).length > 0) {
    await logAudit({
      supabase: ctx.supabase,
      workspaceId: ctx.workspace.id,
      entityType: "workspace_member",
      entityId: input.userId,
      action: "update",
      changes,
      performedBy: ctx.user.id,
    });
  }

  revalidatePath("/dashboard/settings/team");
  return { ok: true, emails: checked.emails };
}
