"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import { getEvolutionConfig, getEvolutionWebhookToken } from "@/lib/evolution-config";
import {
  EvolutionError,
  createGroup,
  ensureGroupsNotIgnored,
  fetchGroupInviteLink,
  fetchGroupParticipants,
  leaveGroup,
  revokeGroupInviteLink,
  setWebhook,
  updateGroupDescription,
  updateGroupParticipants,
  updateGroupPicture,
  updateGroupSetting,
  updateGroupSubject,
} from "@/lib/evolution-client";
import { channelWebhookUrl } from "@/lib/webhook-url";
import { normalizePhone } from "@/lib/phone";
import { parseAvatarDataUrl } from "@/lib/account/validation";
import { sendEvolutionDirect } from "@/lib/flow-engine/send";
import { refreshSavedGroup } from "@/lib/whatsapp-groups/refresh";
import { scheduleJob } from "@/lib/scheduler";
import { GROUP_IMPORT_JOB, groupImportDedupeKey } from "@/lib/whatsapp-groups/import";
import {
  GROUP_PARTICIPANTS_MAX,
  inviteMessage,
  parsePhoneList,
  participantsSummary,
  settingActions,
  validateGroupDescription,
  validateGroupSubject,
  validateParticipantAction,
  type ManagedParticipant,
} from "@/lib/whatsapp-groups/manage";

/**
 * Configurar y crear grupos de WhatsApp desde el sistema (00344): nombre, descripcion, foto, permisos, miembros,
 * link de invitacion, salir del grupo y crear uno nuevo.
 *
 * Pide `channels.manage` (lo mismo que activar grupos en la tarjeta del numero). Escribe con el cliente de servicio
 * DESPUES del permiso, y el workspace sale SIEMPRE de la sesion. WhatsApp ademas exige que el numero sea admin del
 * grupo para casi todo: si se sabe que no lo es, se dice antes de intentar. Cada cambio queda en el historial.
 *
 * Crear una comunidad o meter un grupo en una comunidad no se puede (Evolution no lo permite): se hace desde el
 * celular y el sistema lo toma solo.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_ALLOWED = "Tu rol no puede configurar los grupos.";
const NOT_FOUND = "No encontré ese grupo.";
const NOT_ADMIN = "Este número no es admin del grupo: WhatsApp no deja cambiarlo. Pedile a un admin que lo haga admin.";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function evolutionMessage(err: unknown, fallback: string): string {
  if (err instanceof EvolutionError) {
    console.error("[grupos] WhatsApp rechazo el cambio:", err.status, err.message);
    if (err.status === 401 || err.status === 403) return "WhatsApp no lo permitió. ¿Este número es admin del grupo?";
    if (err.status === 404) return "WhatsApp no encontró el grupo. ¿El número sigue en él?";
    return fallback;
  }
  console.error("[grupos]", err instanceof Error ? err.message : String(err));
  return fallback;
}

async function loadChannel(workspaceId: string, channelId: string) {
  const service = await createServiceClient();
  const { data: channel } = await service
    .from("channels")
    .select("id, workspace_id, provider, evolution_instance, is_active")
    .eq("id", channelId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!channel || channel.provider !== "evolution" || !channel.evolution_instance || !channel.is_active) return null;
  const config = await getEvolutionConfig(service, workspaceId);
  if (!config) return null;
  return { service, channel, instance: channel.evolution_instance, config };
}

async function loadManagedGroup(groupId: string) {
  if (!UUID.test(groupId ?? "")) return { error: NOT_FOUND } as const;
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { error: NOT_ALLOWED } as const;
  const service = await createServiceClient();
  const { data: group } = await service
    .from("whatsapp_groups")
    .select("id, workspace_id, channel_id, group_jid, subject, description, announce, restrict, number_is_admin, left_at")
    .eq("id", groupId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!group || group.left_at) return { error: NOT_FOUND } as const;
  const loaded = await loadChannel(ctx.workspace.id, group.channel_id);
  if (!loaded) return { error: "El número de WhatsApp del grupo no está conectado." } as const;
  return { ctx, group, ...loaded } as const;
}

type Loaded = Exclude<Awaited<ReturnType<typeof loadManagedGroup>>, { error: string }>;

async function audit(loaded: Loaded, op: string, changes: Record<string, { old: Json; new: Json }> | null, extra: Record<string, Json> = {}) {
  await logAudit({
    supabase: loaded.service,
    workspaceId: loaded.ctx.workspace.id,
    entityType: "channel",
    entityId: loaded.group.channel_id,
    action: "update",
    changes,
    metadata: { section: "whatsapp_group_manage", op, group_id: loaded.group.id, ...extra },
    performedBy: loaded.ctx.user.id,
  });
}

function done() {
  revalidatePath("/dashboard/inbox");
}

/** Nombre, descripcion y permisos (solo lo que cambia). */
export async function updateWhatsappGroupDetails(
  groupId: string,
  input: { subject?: string; description?: string; announce?: boolean; restrict?: boolean },
): Promise<Result> {
  const loaded = await loadManagedGroup(groupId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { group, service, config, instance } = loaded;
  if (group.number_is_admin === false) return { ok: false, error: NOT_ADMIN };

  const patch: { subject?: string; description?: string | null; announce?: boolean; restrict?: boolean } = {};
  const changes: Record<string, { old: Json; new: Json }> = {};
  try {
    if (input.subject !== undefined) {
      const subject = validateGroupSubject(input.subject);
      if (!subject.ok) return { ok: false, error: subject.error };
      if (subject.value !== group.subject) {
        await updateGroupSubject(config, instance, group.group_jid, subject.value);
        patch.subject = subject.value;
        changes.subject = { old: group.subject, new: subject.value };
      }
    }
    if (input.description !== undefined) {
      const description = validateGroupDescription(input.description);
      if (!description.ok) return { ok: false, error: description.error };
      if (description.value !== (group.description ?? "")) {
        await updateGroupDescription(config, instance, group.group_jid, description.value);
        patch.description = description.value || null;
        changes.description = { old: group.description ? "(texto)" : null, new: description.value ? "(texto)" : null };
      }
    }
    for (const action of settingActions(group, { announce: input.announce, restrict: input.restrict })) {
      await updateGroupSetting(config, instance, group.group_jid, action);
      if (action === "announcement" || action === "not_announcement") {
        patch.announce = action === "announcement";
        changes.announce = { old: group.announce, new: patch.announce };
      } else {
        patch.restrict = action === "locked";
        changes.restrict = { old: group.restrict, new: patch.restrict };
      }
    }
  } catch (err) {
    // Lo que ya cambio en WhatsApp se guarda igual, para que la pantalla no mienta.
    if (Object.keys(patch).length > 0) await service.from("whatsapp_groups").update(patch).eq("id", group.id);
    return { ok: false, error: evolutionMessage(err, "WhatsApp no aceptó el cambio. Probá de nuevo.") };
  }
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await service.from("whatsapp_groups").update(patch).eq("id", group.id);
  if (error) console.error("[grupos] no pude guardar el cambio:", error.message);
  await audit(loaded, "details", changes);
  done();
  return { ok: true };
}

/**
 * Si el grupo guarda como contacto a quien se une (lo mismo que el tilde de Ajustes → WhatsApp → Grupos, desde el
 * chat). No pide que el numero sea admin: es una eleccion del negocio, no un cambio en WhatsApp.
 */
export async function setWhatsappGroupSaveContacts(groupId: string, saveContacts: boolean): Promise<Result> {
  if (typeof saveContacts !== "boolean") return { ok: false, error: "Pedido inválido." };
  const loaded = await loadManagedGroup(groupId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { group, service } = loaded;
  const { data: before } = await service.from("whatsapp_groups").select("save_contacts").eq("id", group.id).maybeSingle();
  const { error } = await service.from("whatsapp_groups").update({ save_contacts: saveContacts, in_inbox: true }).eq("id", group.id);
  if (error) {
    console.error("[grupos] no pude guardar la opcion de contactos:", error.message);
    return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };
  }
  await audit(loaded, "save_contacts", { save_contacts: { old: before?.save_contacts ?? null, new: saveContacts } });
  done();
  return { ok: true };
}

/** «Importar miembros» desde el chat: trae como contactos a los que ya estaban (sin disparar automatizaciones). */
export async function importWhatsappGroupMembersFromInbox(groupId: string): Promise<Result> {
  const loaded = await loadManagedGroup(groupId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { ctx, group, service } = loaded;
  try {
    await scheduleJob(service, GROUP_IMPORT_JOB, { workspaceId: ctx.workspace.id, groupId: group.id, requestedBy: ctx.user.id }, new Date(), groupImportDedupeKey(group.id));
  } catch (err) {
    // 23505 = ya hay una importacion de este grupo en la cola: no es un error.
    if ((err as { code?: string })?.code !== "23505") {
      console.error("[grupos] no pude encolar la importacion:", err instanceof Error ? err.message : String(err));
      return { ok: false, error: "No pude empezar la importación. Probá de nuevo." };
    }
  }
  return { ok: true };
}

/** La foto del grupo (PNG, JPG o WEBP, mirando los bytes). */
export async function updateWhatsappGroupPhoto(groupId: string, dataUrl: string): Promise<Result> {
  const parsed = parseAvatarDataUrl(dataUrl);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const loaded = await loadManagedGroup(groupId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { group, config, instance } = loaded;
  if (group.number_is_admin === false) return { ok: false, error: NOT_ADMIN };
  try {
    await updateGroupPicture(config, instance, group.group_jid, Buffer.from(parsed.bytes).toString("base64"));
  } catch (err) {
    return { ok: false, error: evolutionMessage(err, "WhatsApp no aceptó la foto. Probá con otra.") };
  }
  await audit(loaded, "photo", null);
  return { ok: true };
}

/** El link de invitacion; con `renew`, anula el viejo y devuelve uno nuevo. */
export async function getWhatsappGroupInvite(groupId: string, opts: { renew?: boolean } = {}): Promise<Result<{ link: string }>> {
  const loaded = await loadManagedGroup(groupId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { group, config, instance } = loaded;
  if (group.number_is_admin === false) return { ok: false, error: NOT_ADMIN };
  try {
    const link = opts.renew
      ? await revokeGroupInviteLink(config, instance, group.group_jid)
      : await fetchGroupInviteLink(config, instance, group.group_jid);
    if (opts.renew) await audit(loaded, "invite_renewed", null);
    return { ok: true, link };
  } catch (err) {
    return { ok: false, error: evolutionMessage(err, "No pude traer el link de invitación.") };
  }
}

/** Los miembros segun WhatsApp (en vivo), con el nombre del contacto si existe. */
export async function listWhatsappGroupParticipants(groupId: string): Promise<Result<{ participants: ManagedParticipant[] }>> {
  const loaded = await loadManagedGroup(groupId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { group, service, config, instance } = loaded;
  try {
    const live = await fetchGroupParticipants(config, instance, group.group_jid);
    const { data: channel } = await service.from("channels").select("display_name").eq("id", group.channel_id).maybeSingle();
    const ownDigits = (channel?.display_name ?? "").replace(/\D/g, "");
    const phones = live.map((p) => normalizePhone(p.phoneNumber?.split("@")[0] ?? (p.id.endsWith("@lid") ? null : p.id.split("@")[0]))).filter((p): p is string => !!p);
    const names = new Map<string, string>();
    if (phones.length > 0) {
      const { data: links } = await service
        .from("contact_channels")
        .select("platform_sender_id, contacts(display_name)")
        .eq("channel_id", group.channel_id)
        .in("platform_sender_id", phones.slice(0, 1000));
      for (const link of (links ?? []) as unknown as Array<{ platform_sender_id: string; contacts: { display_name: string | null } | null }>) {
        if (link.contacts?.display_name) names.set(link.platform_sender_id, link.contacts.display_name);
      }
    }
    const participants: ManagedParticipant[] = live.map((p) => {
      const phone = normalizePhone(p.phoneNumber?.split("@")[0] ?? (p.id.endsWith("@lid") ? null : p.id.split("@")[0]));
      return {
        key: phone ?? p.lid ?? p.id,
        label: (phone && names.get(phone)) || p.name || phone || "Sin teléfono visible",
        phone,
        admin: p.admin,
        isNumber: !!phone && ownDigits.length >= 8 && phone.replace(/\D/g, "") === ownDigits,
      };
    });
    participants.sort((a, b) => Number(b.isNumber) - Number(a.isNumber) || Number(b.admin) - Number(a.admin) || a.label.localeCompare(b.label, "es"));
    return { ok: true, participants };
  } catch (err) {
    return { ok: false, error: evolutionMessage(err, "No pude leer los miembros del grupo.") };
  }
}

/**
 * Agregar (telefonos escritos), sacar, hacer o quitar admin (los `key` de la lista de miembros). Devuelve el resumen y
 * los telefonos que WhatsApp no deja agregar por su privacidad (para mandarles el link).
 */
export async function changeWhatsappGroupParticipants(
  groupId: string,
  rawAction: string,
  people: string | string[],
): Promise<Result<{ summary: string; needsInvite: string[] }>> {
  const action = validateParticipantAction(rawAction);
  if (!action) return { ok: false, error: "Pedido inválido." };
  let list: string[];
  if (action === "add") {
    const { phones, invalid } = parsePhoneList(people);
    if (invalid.length > 0) return { ok: false, error: `No entendí estos teléfonos: ${invalid.join(", ")}. Escribilos con el código de país.` };
    list = phones;
  } else {
    list = (Array.isArray(people) ? people : [people]).map((p) => String(p ?? "").trim()).filter((p) => /^\+?\d{8,15}$/.test(p) || /^\d+@lid$/.test(p));
  }
  if (list.length === 0) return { ok: false, error: action === "add" ? "Escribí al menos un teléfono." : "Elegí al menos una persona." };
  if (list.length > GROUP_PARTICIPANTS_MAX) return { ok: false, error: `De a ${GROUP_PARTICIPANTS_MAX} personas por vez.` };

  const loaded = await loadManagedGroup(groupId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { group, config, instance } = loaded;
  if (group.number_is_admin === false) return { ok: false, error: NOT_ADMIN };
  try {
    const results = await updateGroupParticipants(config, instance, group.group_jid, action, list);
    const needsInvite = results
      .filter((r) => r.status === "needs_invite")
      .map((r) => normalizePhone(r.jid.split("@")[0]))
      .filter((p): p is string => !!p);
    await audit(loaded, `participants_${action}`, null, { count: list.length, ok: results.filter((r) => r.status === "ok").length });
    done();
    return { ok: true, summary: participantsSummary(action, results), needsInvite };
  } catch (err) {
    return { ok: false, error: evolutionMessage(err, "WhatsApp no aceptó el cambio de miembros.") };
  }
}

/**
 * Manda el link de invitacion por privado, desde el numero del grupo, a quien WhatsApp no dejo agregar. Saltea a
 * quien esta marcado como «no contactar».
 */
export async function sendWhatsappGroupInvite(groupId: string, rawPhones: string[]): Promise<Result<{ sent: number; skipped: number }>> {
  const { phones, invalid } = parsePhoneList(rawPhones);
  if (invalid.length > 0 || phones.length === 0) return { ok: false, error: "Pedido inválido." };
  if (phones.length > GROUP_PARTICIPANTS_MAX) return { ok: false, error: `De a ${GROUP_PARTICIPANTS_MAX} personas por vez.` };
  const loaded = await loadManagedGroup(groupId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { ctx, group, service, config, instance } = loaded;

  let link: string;
  try {
    link = await fetchGroupInviteLink(config, instance, group.group_jid);
  } catch (err) {
    return { ok: false, error: evolutionMessage(err, "No pude traer el link de invitación.") };
  }
  const { data: blocked } = await service
    .from("contacts")
    .select("phone")
    .eq("workspace_id", ctx.workspace.id)
    .eq("do_not_contact", true)
    .is("deleted_at", null)
    .in("phone", phones);
  const doNotContact = new Set((blocked ?? []).map((c) => c.phone));

  let sent = 0;
  let skipped = 0;
  for (const phone of phones) {
    if (doNotContact.has(phone)) {
      skipped++;
      continue;
    }
    const outcome = await sendEvolutionDirect(service, config, instance, phone, { text: inviteMessage(group.subject, link) }, { client: service, channelId: group.channel_id });
    if (outcome.ok) sent++;
    else skipped++;
  }
  await audit(loaded, "invite_sent", null, { sent, skipped });
  return { ok: true, sent, skipped };
}

/** El numero sale del grupo. El historial queda guardado; el grupo deja de verse en la bandeja. */
export async function leaveWhatsappGroup(groupId: string): Promise<Result> {
  const loaded = await loadManagedGroup(groupId);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { group, service, config, instance } = loaded;
  try {
    await leaveGroup(config, instance, group.group_jid);
  } catch (err) {
    return { ok: false, error: evolutionMessage(err, "WhatsApp no dejó salir del grupo. Probá de nuevo.") };
  }
  const { error } = await service.from("whatsapp_groups").update({ left_at: new Date().toISOString() }).eq("id", group.id);
  if (error) console.error("[grupos] no pude marcar la salida:", error.message);
  await audit(loaded, "left", null);
  done();
  return { ok: true };
}

/**
 * Crea un grupo en el numero y lo deja activado en la bandeja. Para meterlo en una comunidad hay que vincularlo
 * desde el celular; el sistema lo reconoce solo despues.
 */
export async function createWhatsappGroup(
  channelId: string,
  input: { subject: string; description?: string; participants: string },
): Promise<Result<{ groupId: string; summary: string | null }>> {
  if (!UUID.test(channelId ?? "")) return { ok: false, error: "Pedido inválido." };
  const subject = validateGroupSubject(input?.subject);
  if (!subject.ok) return { ok: false, error: subject.error };
  const description = validateGroupDescription(input?.description ?? "");
  if (!description.ok) return { ok: false, error: description.error };
  const { phones, invalid } = parsePhoneList(input?.participants ?? "");
  if (invalid.length > 0) return { ok: false, error: `No entendí estos teléfonos: ${invalid.join(", ")}. Escribilos con el código de país.` };
  if (phones.length === 0) return { ok: false, error: "WhatsApp pide al menos una persona para crear el grupo." };
  if (phones.length > GROUP_PARTICIPANTS_MAX) return { ok: false, error: `Al crear, hasta ${GROUP_PARTICIPANTS_MAX} personas. Después podés sumar más.` };

  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const loaded = await loadChannel(ctx.workspace.id, channelId);
  if (!loaded) return { ok: false, error: "Ese número de WhatsApp no está conectado." };
  const { service, config, instance } = loaded;

  let jid: string;
  try {
    jid = await createGroup(config, instance, { subject: subject.value, description: description.value || null, participants: phones });
  } catch (err) {
    return { ok: false, error: evolutionMessage(err, "WhatsApp no pudo crear el grupo. Probá de nuevo.") };
  }

  const { data: row, error } = await service
    .from("whatsapp_groups")
    .upsert(
      {
        workspace_id: ctx.workspace.id,
        channel_id: channelId,
        group_jid: jid,
        subject: subject.value,
        description: description.value || null,
        in_inbox: true,
        save_contacts: false,
        number_is_admin: true,
        left_at: null,
      },
      { onConflict: "channel_id,group_jid" },
    )
    .select("id")
    .single();
  if (error || !row) {
    console.error("[grupos] cree el grupo pero no lo pude guardar:", error?.message);
    return { ok: false, error: "El grupo se creó en WhatsApp, pero no lo pude guardar. Activalo desde Ajustes → WhatsApp → Grupos." };
  }

  // Que Evolution avise lo de los grupos, y los datos reales (miembros, permisos). Nada de esto frena.
  try {
    await ensureGroupsNotIgnored(config, instance);
    const token = await getEvolutionWebhookToken(service, ctx.workspace.id);
    if (token) await setWebhook(config, instance, channelWebhookUrl("evolution"), token);
  } catch (err) {
    console.error("[grupos] no pude preparar Evolution para los grupos:", err instanceof Error ? err.message : String(err));
  }
  const live = await refreshSavedGroup(service, { workspaceId: ctx.workspace.id, channelId, groupJid: jid, config, instance });
  const added = live?.size ? live.size - 1 : null;
  const summary = added !== null && added < phones.length ? `WhatsApp agregó ${added} de ${phones.length} personas: al resto mandales el link de invitación desde la configuración del grupo.` : null;

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "channel",
    entityId: channelId,
    action: "create",
    metadata: { section: "whatsapp_group_manage", op: "created", group_id: row.id, participants: phones.length },
    performedBy: ctx.user.id,
  });
  done();
  return { ok: true, groupId: row.id, summary };
}
