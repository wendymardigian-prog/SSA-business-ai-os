/**
 * El núcleo de las acciones de un broadcast: crear, guardar el borrador, poner
 * en cola, pausar, reanudar y cancelar. Recibe los clientes: quien llama ya
 * chequeó `broadcasts.manage` y saca el workspace de la sesión. Escribe con el
 * cliente de SERVICIO (desde la 00285 la tabla no tiene políticas de escritura).
 */
import { loadContactActivity } from "@/lib/contacts/activity";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { parseBroadcastPace } from "@/lib/send-queue/pace";
import { cleanVariants, pickVariant } from "./render";
import { draftProblems } from "./draft";
import { loadBroadcastChannel } from "./channels";
import { audienceParamsOf, resolveAudience, sanitizeAudienceParams } from "./audience-load";

type Client = SupabaseClient<Database>;
export type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];

export type CoreResult<T = void> = ({ ok: true } & (T extends void ? unknown : { value: T })) | { ok: false; error: string };

const fail = (error: string) => ({ ok: false as const, error });

export const MAX_NAME = 120;
export const MAX_SUBJECT = 200;
export const MAX_PREHEADER = 200;
const INSERT_BATCH = 500;

export async function loadBroadcast(service: Client, workspaceId: string, id: string): Promise<BroadcastRow | null> {
  const { data } = await service.from("broadcasts").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  return data ?? null;
}

export async function createBroadcastDraft(
  service: Client,
  input: { workspaceId: string; userId: string; name?: string; audienceParams?: unknown; channelId?: string | null },
): Promise<CoreResult<{ id: string }>> {
  const name = (input.name ?? "").trim().slice(0, MAX_NAME) || "Broadcast sin nombre";
  let channelId: string | null = null;
  if (input.channelId) {
    const channel = await loadBroadcastChannel(service, input.workspaceId, input.channelId);
    channelId = channel?.id ?? null;
  }
  const { data, error } = await service
    .from("broadcasts")
    .insert({
      workspace_id: input.workspaceId,
      name,
      created_by: input.userId,
      audience_params: sanitizeAudienceParams(input.audienceParams) as Json,
      channel_id: channelId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[broadcasts] no pude crear el borrador:", error?.message);
    return fail("No pude crear el broadcast. Probá de nuevo.");
  }
  return { ok: true, value: { id: data.id } };
}

export interface DraftPatch {
  name?: string;
  channelId?: string | null;
  audienceParams?: unknown;
  includePhoneOnly?: boolean;
  variants?: unknown;
  emailSubject?: string | null;
  emailPreheader?: string | null;
  skipMissingVariables?: boolean;
  pace?: unknown;
  scheduledFor?: string | null;
}

/** Guarda los cambios de un borrador. Solo un borrador se edita: lo que ya está en la cola no cambia. */
export async function saveBroadcastDraft(service: Client, workspaceId: string, id: string, patch: DraftPatch): Promise<CoreResult> {
  const update: Database["public"]["Tables"]["broadcasts"]["Update"] = { updated_at: new Date().toISOString() };

  if (patch.name !== undefined) {
    const name = String(patch.name).trim().slice(0, MAX_NAME);
    if (!name) return fail("El broadcast necesita un nombre.");
    update.name = name;
  }
  if (patch.channelId !== undefined) {
    if (patch.channelId === null) update.channel_id = null;
    else {
      const channel = await loadBroadcastChannel(service, workspaceId, String(patch.channelId));
      if (!channel) return fail("Ese canal no está disponible para envíos masivos.");
      update.channel_id = channel.id;
    }
  }
  if (patch.audienceParams !== undefined) update.audience_params = sanitizeAudienceParams(patch.audienceParams) as Json;
  if (patch.includePhoneOnly !== undefined) update.include_phone_only = patch.includePhoneOnly === true;
  if (patch.variants !== undefined) {
    const raw = Array.isArray(patch.variants) ? patch.variants.filter((v): v is string => typeof v === "string").slice(0, 5) : [];
    update.message_variants = raw.map((v) => v.slice(0, 4000)) as Json;
  }
  if (patch.emailSubject !== undefined) update.email_subject = patch.emailSubject ? String(patch.emailSubject).slice(0, MAX_SUBJECT) : null;
  if (patch.emailPreheader !== undefined) update.email_preheader = String(patch.emailPreheader ?? "").trim().slice(0, MAX_PREHEADER) || null;
  if (patch.skipMissingVariables !== undefined) update.skip_missing_variables = patch.skipMissingVariables === true;
  if (patch.pace !== undefined) update.pace = parseBroadcastPace(patch.pace) as Json;
  if (patch.scheduledFor !== undefined) {
    if (patch.scheduledFor === null || patch.scheduledFor === "") update.scheduled_for = null;
    else {
      const at = new Date(String(patch.scheduledFor));
      if (Number.isNaN(at.getTime())) return fail("La fecha de envío no es válida.");
      update.scheduled_for = at.toISOString();
    }
  }

  const { data, error } = await service
    .from("broadcasts")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("status", "draft")
    .select("id");
  if (error) {
    console.error("[broadcasts] no pude guardar el borrador:", error.message);
    return fail("No pude guardar los cambios. Probá de nuevo.");
  }
  if (!data || data.length === 0) return fail("Este broadcast ya no es un borrador: no se puede editar.");
  return { ok: true };
}

/**
 * Pone un borrador en la cola: congela la audiencia (con el cliente de la
 * persona, así la RLS decide a quién ve), guarda cada destinatario con su
 * destino y su variante, y lo marca `sending` (o `scheduled` si tiene fecha).
 * Los que quedan afuera también se guardan, como `skipped` con su motivo.
 */
export async function queueBroadcast(
  userClient: Client,
  service: Client,
  input: { workspaceId: string; id: string; timeZone: string; now?: Date },
): Promise<CoreResult<{ sendable: number; skipped: number }>> {
  const now = input.now ?? new Date();
  const b = await loadBroadcast(service, input.workspaceId, input.id);
  if (!b) return fail("No encontré ese broadcast.");
  if (b.status !== "draft") return fail("Este broadcast ya se puso en cola.");

  const channel = b.channel_id ? await loadBroadcastChannel(service, input.workspaceId, b.channel_id) : null;
  const { data: fieldRows } = await service.from("custom_field_definitions").select("slug").eq("workspace_id", input.workspaceId).is("deleted_at", null);
  const problems = draftProblems(b, channel?.kind ?? null, fieldRows ?? []);
  if (problems.length > 0 || !channel) return fail(problems[0] ?? "Elegí por qué canal sale.");

  const audience = await resolveAudience(userClient, service, {
    workspaceId: input.workspaceId,
    params: audienceParamsOf(b.audience_params),
    channel,
    includePhoneOnly: channel.kind === "whatsapp" && b.include_phone_only,
    timeZone: input.timeZone,
    collect: true,
    now,
  });
  if (audience.reach.sendable === 0) return fail("Con estos filtros y este canal no queda nadie a quien mandarle.");

  // Se toma el borrador ANTES de escribir los destinatarios: dos clics = una cola.
  const scheduled = b.scheduled_for !== null && new Date(b.scheduled_for).getTime() > now.getTime();
  const { data: claimed, error: claimError } = await service
    .from("broadcasts")
    .update({
      status: scheduled ? "scheduled" : "sending",
      started_at: scheduled ? null : now.toISOString(),
      total_recipients: audience.reach.sendable,
      skipped: audience.reach.total - audience.reach.sendable,
      updated_at: now.toISOString(),
    })
    .eq("id", b.id)
    .eq("status", "draft")
    .select("id");
  if (claimError || !claimed || claimed.length === 0) return fail("Este broadcast ya se puso en cola.");

  const variants = cleanVariants(b.message_variants);
  // Primero los más activos (00288): con el tope diario de marketing, el día lo usan quienes más probablemente abren.
  const activity = await loadContactActivity(service, input.workspaceId, audience.recipients.filter((r) => r.classification.ok).map((r) => r.contactId));
  const rows = audience.recipients.map((r) => ({
    broadcast_id: b.id,
    workspace_id: input.workspaceId,
    contact_id: r.contactId,
    channel_id: channel.id,
    status: (r.classification.ok ? "pending" : "skipped") as "pending" | "skipped",
    target: r.classification.ok ? r.classification.target : null,
    skip_reason: r.classification.ok ? null : r.classification.reason,
    variant_index: pickVariant(`${b.id}:${r.contactId}`, variants.length),
    sort_key: activity.get(r.contactId) ?? null,
  }));

  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await service
      .from("broadcast_recipients")
      .upsert(rows.slice(i, i + INSERT_BATCH), { onConflict: "broadcast_id,contact_id", ignoreDuplicates: true });
    if (error) {
      console.error("[broadcasts] no pude guardar los destinatarios:", error.message);
      // Vuelve a borrador sin dejar nada a medias: la cola no toma un borrador.
      await service.from("broadcast_recipients").delete().eq("broadcast_id", b.id);
      await service.from("broadcasts").update({ status: "draft", started_at: null, total_recipients: 0, skipped: 0 }).eq("id", b.id);
      return fail("No pude armar la cola. Probá de nuevo.");
    }
  }

  // El carril del canal (una fila por canal; si ya existía, queda como estaba).
  await service
    .from("channel_send_lanes")
    .upsert({ channel_id: channel.id, workspace_id: input.workspaceId }, { onConflict: "channel_id", ignoreDuplicates: true });
  await service.rpc("refresh_broadcast_counts", { p_broadcast_id: b.id });

  return { ok: true, value: { sendable: audience.reach.sendable, skipped: audience.reach.total - audience.reach.sendable } };
}

/** Pausa: la cola deja de tomar sus destinatarios (el que está saliendo termina). */
export async function pauseBroadcast(service: Client, workspaceId: string, id: string): Promise<CoreResult> {
  const { data } = await service
    .from("broadcasts")
    .update({ status: "paused", paused_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .in("status", ["sending", "scheduled"])
    .select("id");
  return data && data.length > 0 ? { ok: true } : fail("Solo se pausa un broadcast que se está enviando o está programado.");
}

export async function resumeBroadcast(service: Client, workspaceId: string, id: string): Promise<CoreResult> {
  const b = await loadBroadcast(service, workspaceId, id);
  if (!b || b.status !== "paused") return fail("Solo se reanuda un broadcast pausado.");
  const scheduled = b.scheduled_for !== null && new Date(b.scheduled_for).getTime() > Date.now();
  const { data } = await service
    .from("broadcasts")
    .update({ status: scheduled ? "scheduled" : "sending", paused_at: null, started_at: b.started_at ?? (scheduled ? null : new Date().toISOString()) })
    .eq("id", id)
    .eq("status", "paused")
    .select("id");
  if (!data || data.length === 0) return fail("Solo se reanuda un broadcast pausado.");
  await service.rpc("refresh_broadcast_counts", { p_broadcast_id: id });
  return { ok: true };
}

/** Cancela: lo que falta mandar queda `cancelled` (no se borra) y el broadcast termina. */
export async function cancelBroadcast(service: Client, workspaceId: string, id: string): Promise<CoreResult> {
  const { data } = await service
    .from("broadcasts")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .in("status", ["sending", "scheduled", "paused"])
    .select("id");
  if (!data || data.length === 0) return fail("Este broadcast ya terminó o no empezó.");
  await service.from("broadcast_recipients").update({ status: "cancelled" }).eq("broadcast_id", id).eq("status", "pending");
  await service.rpc("refresh_broadcast_counts", { p_broadcast_id: id });
  return { ok: true };
}

/** Un borrador se puede borrar (nunca salió nada). Lo que se envió queda como historia. */
export async function deleteBroadcastDraft(service: Client, workspaceId: string, id: string): Promise<CoreResult> {
  const { data } = await service.from("broadcasts").delete().eq("id", id).eq("workspace_id", workspaceId).eq("status", "draft").select("id");
  return data && data.length > 0 ? { ok: true } : fail("Solo se borra un borrador.");
}

/** Vuelve a habilitar un carril que se pausó solo por fallos seguidos. */
export async function resumeLane(service: Client, workspaceId: string, channelId: string): Promise<CoreResult> {
  const { data } = await service
    .from("channel_send_lanes")
    .update({ paused_at: null, paused_reason: null, consecutive_failures: 0, next_send_at: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("workspace_id", workspaceId)
    .select("channel_id");
  return data && data.length > 0 ? { ok: true } : fail("No encontré ese canal.");
}
