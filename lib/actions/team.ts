"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getWorkspace, setActiveWorkspaceCookie } from "@/lib/workspace";
import { sendTransactionalEmail } from "@/lib/email/send";
import { teamInviteEmail } from "@/lib/email/templates";
import { resolveBrand } from "@/lib/brand";
import { inviteUrl } from "@/lib/app-url";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { parsePermissions, systemRolePermissions } from "@/lib/auth/permissions";
import { assertCanAssignRole, grantActorOf, type RoleToGive } from "@/lib/team/grant";
import { canResend, inviteState, invalidInviteMessage, renewedExpiry } from "@/lib/team/invite-state";
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

export type InviteDelivery = "email" | "link";

type Fail = { ok: false; error: string };

const NO_INVITE = "No tenés permiso para invitar personas";
const NO_MANAGE = "No tenés permiso para administrar el equipo";

/** El rol que se quiere dar, con sus permisos resueltos (los de sistema salen del codigo, no de la fila vacia). */
async function loadRoleToGive(
  ctx: PermissionContext,
  roleId: string,
): Promise<(RoleToGive & { name: string }) | null> {
  const { data: role } = await ctx.supabase
    .from("workspace_roles")
    .select("id, name, system_role, permissions")
    .eq("id", roleId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!role) return null;
  const systemRole = (role.system_role as RoleToGive["systemRole"]) ?? null;
  return {
    id: role.id,
    name: role.name,
    systemRole,
    permissions: systemRole ? (systemRolePermissions(systemRole) ?? parsePermissions(null)) : parsePermissions(role.permissions),
  };
}

/** Manda el correo de la invitacion y dice como salio. Nunca lanza: el link sirve igual. */
async function sendInviteEmail(
  ctx: PermissionContext,
  invite: { id: string; email: string },
  roleName: string,
): Promise<{ status: InviteEmailStatus; error: string | null }> {
  const content = teamInviteEmail({
    workspaceName: ctx.workspace.name,
    inviteUrl: inviteUrl(invite.id),
    roleLabel: roleName,
    brandColor: resolveBrand(ctx.workspace).colorHex,
  });
  const sent = await sendTransactionalEmail({
    workspaceId: ctx.workspace.id,
    to: invite.email,
    subject: content.subject,
    html: content.html,
    kind: "team_invite",
    relatedEntityType: "workspace_invite",
    relatedEntityId: invite.id,
    createdBy: ctx.user.id,
  });
  return {
    status: sent.ok ? "sent" : sent.reason === "not_configured" ? "not_configured" : "failed",
    error: sent.ok ? null : sent.error,
  };
}

/**
 * Invitar a alguien (F7): por email o solo generando el link.
 *
 * El rol puede ser cualquiera que quien invita pueda dar (`assertCanGrant`): un Admin solo lo da un
 * Owner o Admin, y un rol personalizado solo con permisos que uno mismo tiene. La invitacion guarda
 * `role_id` y el rol base `role` (admin si es el Admin de sistema; si no, member). Siempre se
 * devuelve el link. Con `delivery = 'link'` NO se llama a Resend.
 */
export async function inviteTeamMember(input: {
  email: string;
  roleId: string;
  delivery: InviteDelivery;
}): Promise<
  | { ok: true; invite: { id: string; email: string; role: string; role_id: string | null }; inviteUrl: string; emailStatus: InviteEmailStatus | null; emailError: string | null }
  | (Fail & { existingInviteUrl?: string })
> {
  const ctx = await getPermissionAction("team.invite");
  if (!ctx) return { ok: false, error: NO_INVITE };

  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false, error: "Hace falta un email válido" };
  if (input.delivery !== "email" && input.delivery !== "link") return { ok: false, error: "Elegí cómo mandar la invitación" };

  const role = await loadRoleToGive(ctx, input.roleId);
  if (!role) return { ok: false, error: "No encontré ese rol" };

  const granted = assertCanAssignRole(grantActorOf(ctx), role, null);
  if (!granted.ok) return { ok: false, error: granted.error };

  // Esa persona ya esta en el equipo. Los emails viven en auth.users: se leen con el service client.
  const service = await createServiceClient();
  const { data: profiles } = await service.rpc("workspace_member_profiles", { p_workspace_id: ctx.workspace.id });
  if ((profiles ?? []).some((p) => (p.email ?? "").toLowerCase() === email)) {
    return { ok: false, error: "Esa persona ya está en el equipo" };
  }

  // Ya hay una invitacion vigente para ese email: se ofrece su link en vez de crear otra.
  const { data: existing } = await ctx.supabase
    .from("workspace_invites")
    .select("id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("email", email)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { ok: false, error: "Ya hay una invitación pendiente para ese email", existingInviteUrl: inviteUrl(existing.id) };
  }

  const { data: invite, error: insertError } = await ctx.supabase
    .from("workspace_invites")
    .insert({
      workspace_id: ctx.workspace.id,
      email,
      role: role.systemRole === "admin" ? "admin" : "member",
      role_id: role.id,
      invited_by: ctx.user.id,
      status: "pending",
      delivery: input.delivery,
    })
    .select("id, email, role, role_id")
    .single();
  if (insertError || !invite) {
    console.error("[equipo] no pude crear la invitación:", insertError?.message ?? "sin fila");
    return { ok: false, error: "No pude crear la invitación" };
  }

  // El email es best-effort: la invitacion ya existe y el link sirve igual.
  let emailStatus: InviteEmailStatus | null = null;
  let emailError: string | null = null;
  if (input.delivery === "email") {
    const sent = await sendInviteEmail(ctx, invite, role.name);
    emailStatus = sent.status;
    emailError = sent.error;
    await ctx.supabase
      .from("workspace_invites")
      .update({ email_status: sent.status, email_error: sent.error, last_sent_at: new Date().toISOString(), send_count: 1 })
      .eq("id", invite.id);
  }

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "workspace_member", entityId: invite.id,
    action: "create",
    metadata: { stage: "invite", kind: "invite_created", email, role: role.name, delivery: input.delivery, email_status: emailStatus },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/settings/team");
  return { ok: true, invite, inviteUrl: inviteUrl(invite.id), emailStatus, emailError };
}

/** Una invitacion del workspace de quien pregunta, o null. */
async function loadInvite(ctx: PermissionContext, inviteId: string) {
  const { data } = await ctx.supabase
    .from("workspace_invites")
    .select("id, email, role, role_id, status, expires_at, delivery, send_count, last_sent_at")
    .eq("id", inviteId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  return data;
}

/**
 * Volver a mandar el email de una invitacion (F8): como mucho una vez por minuto y cinco en total.
 * El tope lo cumple la base: el UPDATE exige que `send_count` siga siendo el que se leyo, asi dos
 * clics a la vez mandan un solo correo.
 */
export async function resendInvite(inviteId: string): Promise<
  { ok: true; inviteUrl: string; emailStatus: InviteEmailStatus; emailError: string | null } | Fail
> {
  const ctx = await getPermissionAction("team.invite");
  if (!ctx) return { ok: false, error: NO_INVITE };

  const invite = await loadInvite(ctx, inviteId);
  if (!invite) return { ok: false, error: "No encontré esa invitación" };

  const check = canResend(invite);
  if (!check.ok) return { ok: false, error: check.error };

  // Reservar el envio ANTES de mandar: el que gana el UPDATE es el unico que manda.
  const now = new Date().toISOString();
  const { data: claimed } = await ctx.supabase
    .from("workspace_invites")
    .update({ send_count: (invite.send_count ?? 0) + 1, last_sent_at: now, delivery: "email" })
    .eq("id", invite.id)
    .eq("send_count", invite.send_count ?? 0)
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, error: "Esta invitación se acaba de mandar. Probá en un minuto." };

  const role = invite.role_id ? await loadRoleToGive(ctx, invite.role_id) : null;
  const sent = await sendInviteEmail(ctx, invite, role?.name ?? (invite.role === "admin" ? "Admin" : "Member"));
  await ctx.supabase.from("workspace_invites").update({ email_status: sent.status, email_error: sent.error }).eq("id", invite.id);

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "workspace_member", entityId: invite.id,
    action: "update",
    metadata: { stage: "invite", kind: "invite_resent", email: invite.email, email_status: sent.status },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/settings/team");
  return { ok: true, inviteUrl: inviteUrl(invite.id), emailStatus: sent.status, emailError: sent.error };
}

/** Renovar una invitacion (F8): vale 7 dias desde ahora, este vencida o no. */
export async function renewInvite(inviteId: string): Promise<{ ok: true; expiresAt: string } | Fail> {
  const ctx = await getPermissionAction("team.invite");
  if (!ctx) return { ok: false, error: NO_INVITE };

  const invite = await loadInvite(ctx, inviteId);
  if (!invite) return { ok: false, error: "No encontré esa invitación" };
  if (invite.status !== "pending") return { ok: false, error: invalidInviteMessage(inviteState(invite)).title };

  const expiresAt = renewedExpiry();
  const { data: updated } = await ctx.supabase
    .from("workspace_invites")
    .update({ expires_at: expiresAt })
    .eq("id", invite.id)
    .eq("status", "pending")
    .select("id");
  if (!updated || updated.length === 0) return { ok: false, error: "No pude renovar la invitación" };

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "workspace_member", entityId: invite.id,
    action: "update",
    metadata: { stage: "invite", kind: "invite_renewed", email: invite.email },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/settings/team");
  return { ok: true, expiresAt };
}

/**
 * Anular una invitacion (F8). Es un UPDATE: la fila queda como "anulada" en el historial,
 * ya no se borra. Una aceptada no se anula.
 */
export async function revokeInvite(inviteId: string): Promise<{ ok: true } | Fail> {
  const ctx = await getPermissionAction("team.invite");
  if (!ctx) return { ok: false, error: NO_INVITE };

  const invite = await loadInvite(ctx, inviteId);
  if (!invite) return { ok: false, error: "No encontré esa invitación" };
  if (invite.status !== "pending") return { ok: false, error: invalidInviteMessage(inviteState(invite)).title };

  const { data: updated, error } = await ctx.supabase
    .from("workspace_invites")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: ctx.user.id })
    .eq("id", invite.id)
    .eq("status", "pending")
    .select("id");
  if (error || !updated || updated.length === 0) {
    if (error) console.error("[equipo] no pude anular la invitación:", error.message);
    return { ok: false, error: "No pude anular la invitación" };
  }

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "workspace_member", entityId: invite.id,
    action: "update",
    metadata: { stage: "invite_revoked", kind: "invite_revoked", email: invite.email },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/settings/team");
  return { ok: true };
}

/**
 * El link de una invitacion (F8). Es una credencial: quien lo abre crea la cuenta con ese email.
 * Por eso copiarlo deja una entrada en el historial (`invite_link_copied`).
 */
export async function copyInviteLink(inviteId: string): Promise<{ ok: true; inviteUrl: string } | Fail> {
  const ctx = await getPermissionAction("team.invite");
  if (!ctx) return { ok: false, error: NO_INVITE };

  const invite = await loadInvite(ctx, inviteId);
  if (!invite) return { ok: false, error: "No encontré esa invitación" };
  if (invite.status !== "pending") return { ok: false, error: invalidInviteMessage(inviteState(invite)).title };

  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "workspace_member", entityId: invite.id,
    action: "update",
    metadata: { stage: "invite", kind: "invite_link_copied", email: invite.email },
    performedBy: ctx.user.id,
  });
  return { ok: true, inviteUrl: inviteUrl(invite.id) };
}

/**
 * Quitar a alguien del equipo (F11). Solo con `team.remove`, que tiene el Owner y nadie mas.
 * Nadie se quita a si mismo, y el workspace no se queda sin Owner.
 */
export async function removeTeamMember(workspaceId: string, userId: string): Promise<{ ok: true } | Fail> {
  const ctx = await getPermissionAction("team.remove");
  if (!ctx) return { ok: false, error: "Solo el Owner puede quitar miembros" };
  if (ctx.workspace.id !== workspaceId) return { ok: false, error: "El workspace no coincide" };

  if (userId === ctx.user.id) return { ok: false, error: "No podés quitarte a vos mismo del workspace" };

  const { data: target } = await ctx.supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return { ok: false, error: "Esa persona no está en el equipo" };

  // No se queda el negocio sin Owner: es quien puede transferirlo y recuperarlo.
  if (target.role === "owner") {
    const { count } = await ctx.supabase
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) return { ok: false, error: "Es el único Owner del negocio: no se puede quitar." };
  }

  const { error: deleteError } = await ctx.supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", userId);
  if (deleteError) {
    console.error("[equipo] no pude quitar a la persona:", deleteError.message);
    return { ok: false, error: "No pude quitar a la persona" };
  }

  // La entidad es la persona que se fue: es lo que se va a querer buscar
  // cuando alguien pregunte por que un lead quedo sin dueño.
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "workspace_member", entityId: userId,
    action: "delete", metadata: { kind: "member_removed", role: target.role }, performedBy: ctx.user.id,
  });

  // Llamadas: su Fathom se desconecta con la persona (sus llamadas quedan, son
  // del negocio). Un paso posterior y aparte: si falla, salir del equipo ya paso.
  try {
    await revokeFathomConnectionsOf(await createServiceClient(), ctx.workspace.id, userId);
  } catch (err) {
    console.error("[equipo] no pude revocar el Fathom de quien salió:", err instanceof Error ? err.message : "error");
  }

  revalidatePath("/dashboard/settings/team");
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
  // Anulada, aceptada o vencida: el mismo mensaje; la vencida agrega que pidan una renovacion.
  const state = inviteState(invite);
  if (state !== "pending") {
    const msg = invalidInviteMessage(state);
    return { ok: false, error: msg.hint ? `${msg.title}. ${msg.hint}` : msg.title };
  }
  if (expectedEmail && invite.email !== expectedEmail) {
    return { ok: false, error: "Esta invitación se mandó a otro email" };
  }
  return { ok: true, invite };
}

/**
 * El rol con el que entra la persona: el de la invitacion, o, si ese rol ya no existe (se borro:
 * la columna queda en NULL) o la invitacion es de antes de los roles, el rol de sistema que dice
 * su `role` (Member si no hay otro).
 */
async function roleIdForInvite(serviceClient: ServiceClient, invite: InviteRow): Promise<string | null> {
  const roleId = typeof invite.role_id === "string" ? invite.role_id : null;
  if (roleId) {
    const { data } = await serviceClient
      .from("workspace_roles")
      .select("id")
      .eq("id", roleId)
      .eq("workspace_id", invite.workspace_id)
      .maybeSingle();
    if (data) return data.id;
  }
  const { data: system } = await serviceClient
    .from("workspace_roles")
    .select("id")
    .eq("workspace_id", invite.workspace_id)
    .eq("system_role", invite.role === "admin" ? "admin" : "member")
    .maybeSingle();
  return system?.id ?? null;
}

/** Suma al workspace y marca la invitacion aceptada. Service client: bypassea la RLS de owner-only sobre workspace_members. */
async function finalizeAcceptInvite(serviceClient: ServiceClient, invite: InviteRow, userId: string) {
  const accepted = { status: "accepted", accepted_at: new Date().toISOString(), accepted_by: userId };

  const { data: existingMembership } = await serviceClient
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", invite.workspace_id)
    .eq("user_id", userId)
    .single();

  if (existingMembership) {
    await serviceClient.from("workspace_invites").update(accepted).eq("id", invite.id);
    // Quien ya es miembro de otro negocio de la instalacion entra al de la invitacion, no al que tenia elegido.
    await setActiveWorkspaceCookie(invite.workspace_id);
    return { ok: true as const, workspaceId: invite.workspace_id, alreadyMember: true };
  }

  const { error: insertError } = await serviceClient.from("workspace_members").insert({
    workspace_id: invite.workspace_id,
    user_id: userId,
    role: invite.role,
    role_id: await roleIdForInvite(serviceClient, invite),
  });

  if (insertError) {
    return { ok: false as const, error: insertError.message };
  }

  await serviceClient.from("workspace_invites").update(accepted).eq("id", invite.id);
  await setActiveWorkspaceCookie(invite.workspace_id);
  try {
    await logAudit({
      supabase: serviceClient, workspaceId: invite.workspace_id, entityType: "workspace_member", entityId: invite.id,
      action: "update", metadata: { stage: "invite", kind: "invite_accepted", user_id: userId }, performedBy: null,
    });
  } catch (err) {
    console.error("[equipo] no pude anotar la invitación aceptada:", err instanceof Error ? err.message : "error");
  }
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
  const ctx = await getPermissionAction("team.manage");
  if (!ctx) return { error: NO_MANAGE };

  if (ctx.workspace.id !== workspaceId) return { error: "El workspace no coincide" };
  if (newRole !== "admin" && newRole !== "member") return { error: "Rol invalido. Tiene que ser member o admin." };
  if (userId === ctx.user.id) return { error: "No podes cambiar tu propio rol" };

  // El rol del target lo leemos con el service client.
  const serviceClient = await createServiceClient();
  const { data: target } = await serviceClient
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .single();

  if (!target) return { error: "Ese miembro no pertenece al workspace" };
  if (target.role === "owner") return { error: "No se puede cambiar el rol del Owner del workspace" };
  if (target.role === newRole) return { ok: true, role: newRole };

  // Dar Admin solo lo hace un Owner o un Admin; dar Member exige tener lo que tiene el Member.
  const { data: systemRole } = await ctx.supabase
    .from("workspace_roles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("system_role", newRole)
    .maybeSingle();
  if (!systemRole) return { error: "No encontré ese rol" };
  const role = await loadRoleToGive(ctx, systemRole.id);
  if (!role) return { error: "No encontré ese rol" };
  const granted = assertCanAssignRole(grantActorOf(ctx), role, { userId, memberRole: target.role as "owner" | "admin" | "member" });
  if (!granted.ok) return { error: granted.error };

  const { error: updateError } = await ctx.supabase
    .from("workspace_members")
    .update({ role: newRole, role_id: systemRole.id })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (updateError) return { error: updateError.message };

  await logAudit({
    supabase: ctx.supabase, workspaceId, entityType: "workspace_member", entityId: userId,
    action: "update",
    changes: { role: { old: target.role, new: newRole } },
    performedBy: ctx.user.id,
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
  if (!ctx) return { ok: false, error: NO_MANAGE };

  const [role, { data: member }] = await Promise.all([
    loadRoleToGive(ctx, input.roleId),
    ctx.supabase
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", ctx.workspace.id)
      .eq("user_id", input.userId)
      .maybeSingle(),
  ]);

  if (!role) return { ok: false, error: "No encontre ese rol" };
  if (!member) return { ok: false, error: "Esa persona no esta en el equipo" };

  // No podes dar lo que no tenes; nadie se cambia su propio rol ni toca al Owner (lib/team/grant.ts).
  const granted = assertCanAssignRole(grantActorOf(ctx), role, {
    userId: input.userId,
    memberRole: member.role as "owner" | "admin" | "member",
  });
  if (!granted.ok) return { ok: false, error: granted.error };

  // El rol base: los personalizados son siempre `member`.
  const baseRole = role.systemRole ?? "member";

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
