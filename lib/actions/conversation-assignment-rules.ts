"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { checkRuleInput, type RuleInput } from "@/lib/inbox/assignment-rules";
import { checkKnownSettings, serializeKnownSettings } from "@/lib/inbox/known";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import type { Json } from "@/lib/types/database";

/**
 * Reglas de asignacion de CONVERSACIONES por cuenta (Ajustes > Asignación,
 * 00255). Todo pide `assignment.manage`; la tabla no tiene policies de
 * escritura, asi que se escribe con el cliente de servicio DESPUES del guard,
 * siempre filtrando por el workspace de la sesion. Nada se borra: se archiva.
 */

const SETTINGS_PATH = "/dashboard/settings/asignacion";
const NOT_ALLOWED = "Tu rol no puede cambiar las reglas de asignación.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { ok: true } | { ok: false; error: string };

async function knownIds(workspaceId: string) {
  const service = await createServiceClient();
  const [members, channelsRes] = await Promise.all([
    getWorkspaceMembers(workspaceId),
    service.from("channels").select("id").eq("workspace_id", workspaceId).eq("is_active", true),
  ]);
  return { service, memberIds: members.map((m) => m.userId), channelIds: (channelsRes.data ?? []).map((c) => c.id) };
}

function snapshot(value: { name: string; enabled: boolean; channelIds: string[]; mode: string; memberIds: string[]; setterMode: string }): Json {
  return {
    name: value.name,
    enabled: value.enabled,
    channel_ids: value.channelIds,
    mode: value.mode,
    member_ids: value.memberIds,
    setter_mode: value.setterMode,
  };
}

export async function createConversationRule(input: RuleInput): Promise<Result> {
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { service, memberIds, channelIds } = await knownIds(ctx.workspace.id);
  const checked = checkRuleInput(input, { memberIds, channelIds });
  if (!checked.ok) return checked;

  // Va al final de la lista.
  const { data: last } = await service
    .from("conversation_assignment_rules")
    .select("position")
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const v = checked.value;
  const { data: created, error } = await service
    .from("conversation_assignment_rules")
    .insert({
      workspace_id: ctx.workspace.id,
      name: v.name,
      enabled: v.enabled,
      channel_ids: v.channelIds,
      mode: v.mode,
      member_ids: v.memberIds,
      setter_mode: v.setterMode,
      position: (last?.position ?? -1) + 1,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[reglas-conversaciones] no pude crear:", error?.message);
    return { ok: false, error: "No pude guardar la regla. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "assignment_rule",
    entityId: created.id,
    action: "assignment_rule.created",
    changes: { rule: { old: null, new: snapshot(v) } },
    metadata: { entity: "conversation" },
    performedBy: ctx.user.id,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function updateConversationRule(id: string, input: RuleInput): Promise<Result> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Pedido inválido." };
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { service, memberIds, channelIds } = await knownIds(ctx.workspace.id);
  const checked = checkRuleInput(input, { memberIds, channelIds });
  if (!checked.ok) return checked;

  const { data: before } = await service
    .from("conversation_assignment_rules")
    .select("id, name, enabled, channel_ids, mode, member_ids, setter_mode")
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!before) return { ok: false, error: "No encontré esa regla." };

  const v = checked.value;
  const { error } = await service
    .from("conversation_assignment_rules")
    .update({
      name: v.name,
      enabled: v.enabled,
      channel_ids: v.channelIds,
      mode: v.mode,
      member_ids: v.memberIds,
      setter_mode: v.setterMode,
      updated_by: ctx.user.id,
      // Cambiar la gente o el modo reinicia el turno.
      ...(before.mode !== v.mode || before.member_ids.join() !== v.memberIds.join() ? { last_assigned_member_id: null } : {}),
    })
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[reglas-conversaciones] no pude guardar:", error.message);
    return { ok: false, error: "No pude guardar la regla. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "assignment_rule",
    entityId: id,
    action: "assignment_rule.updated",
    changes: {
      rule: {
        old: snapshot({
          name: before.name,
          enabled: before.enabled,
          channelIds: before.channel_ids,
          mode: before.mode,
          memberIds: before.member_ids,
          setterMode: before.setter_mode,
        }),
        new: snapshot(v),
      },
    },
    metadata: { entity: "conversation" },
    performedBy: ctx.user.id,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function archiveConversationRule(id: string): Promise<Result> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Pedido inválido." };
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const service = await createServiceClient();
  const { data, error } = await service
    .from("conversation_assignment_rules")
    .update({ archived_at: new Date().toISOString(), enabled: false, updated_by: ctx.user.id })
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "No pude archivar la regla." };

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "assignment_rule",
    entityId: id,
    action: "assignment_rule.archived",
    metadata: { entity: "conversation" },
    performedBy: ctx.user.id,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/** El orden nuevo, completo (los ids en el orden en que se prueban). */
export async function reorderConversationRules(ids: string[]): Promise<Result> {
  if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== "string" || !UUID.test(id))) {
    return { ok: false, error: "Pedido inválido." };
  }
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const service = await createServiceClient();
  const { data: current } = await service
    .from("conversation_assignment_rules")
    .select("id")
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null);
  const known = new Set((current ?? []).map((r) => r.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    return { ok: false, error: "Las reglas cambiaron mientras las ordenabas. Recargá la página." };
  }

  for (const [position, id] of ids.entries()) {
    const { error } = await service
      .from("conversation_assignment_rules")
      .update({ position, updated_by: ctx.user.id })
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id);
    if (error) {
      console.error("[reglas-conversaciones] no pude ordenar:", error.message);
      return { ok: false, error: "No pude guardar el orden. Probá de nuevo." };
    }
  }
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/**
 * A quien van los chats de un conocido, por cuenta (00256): una persona por
 * cuenta y una por defecto; sin nada, el Owner. `workspaces` sigue siendo de
 * Admin en la base: se escribe con el cliente de servicio DESPUES de la clave,
 * filtrando por el workspace de la sesion.
 */
export async function saveKnownContactsSettings(input: { byChannel?: unknown; defaultUserId?: unknown }): Promise<Result> {
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { service, memberIds, channelIds } = await knownIds(ctx.workspace.id);
  const checked = checkKnownSettings(input ?? {}, { memberIds, channelIds });
  if (!checked.ok) return checked;

  const { data: before } = await service.from("workspaces").select("known_contacts_settings").eq("id", ctx.workspace.id).maybeSingle();
  const next = serializeKnownSettings(checked.value);
  const { error } = await service.from("workspaces").update({ known_contacts_settings: next as unknown as Json }).eq("id", ctx.workspace.id);
  if (error) {
    console.error("[conocidos] no pude guardar:", error.message);
    return { ok: false, error: "No pude guardar. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "update",
    changes: { known_contacts_settings: { old: (before?.known_contacts_settings ?? {}) as Json, new: next as unknown as Json } },
    metadata: { section: "known_contacts_settings" },
    performedBy: ctx.user.id,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/**
 * A quien van los chats de un cliente, por cuenta (00268). Misma forma que la de
 * los conocidos; sin nada configurado, el responsable no cambia.
 */
export async function saveCustomerContactsSettings(input: { byChannel?: unknown; defaultUserId?: unknown }): Promise<Result> {
  const ctx = await getPermissionAction("assignment.manage");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { service, memberIds, channelIds } = await knownIds(ctx.workspace.id);
  const checked = checkKnownSettings(input ?? {}, { memberIds, channelIds });
  if (!checked.ok) return checked;

  const { data: before } = await service.from("workspaces").select("customer_contacts_settings").eq("id", ctx.workspace.id).maybeSingle();
  const next = serializeKnownSettings(checked.value);
  const { error } = await service.from("workspaces").update({ customer_contacts_settings: next as unknown as Json }).eq("id", ctx.workspace.id);
  if (error) {
    console.error("[clientes] no pude guardar:", error.message);
    return { ok: false, error: "No pude guardar. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "update",
    changes: { customer_contacts_settings: { old: (before?.customer_contacts_settings ?? {}) as Json, new: next as unknown as Json } },
    metadata: { section: "customer_contacts_settings" },
    performedBy: ctx.user.id,
  });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}
