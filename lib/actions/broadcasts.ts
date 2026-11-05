"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { searchParamsToRecord } from "@/lib/url-params";
import { DEFAULT_WHATSAPP_POLICY, parsePolicy, type SendPolicy } from "@/lib/send-queue/pace";
import { loadBroadcastChannel } from "@/lib/broadcasts/channels";
import { loadRenderData, resolveAudience, sanitizeAudienceParams } from "@/lib/broadcasts/audience-load";
import { SKIP_REASON_LABELS, type AudienceSkipReason } from "@/lib/broadcasts/audience";
import type { AudiencePreview, MessagePreview } from "@/lib/broadcasts/preview-types";
import { broadcastVariables, cleanVariants, pickVariant, renderChatMessage, renderEmail } from "@/lib/broadcasts/render";
import {
  cancelBroadcast,
  createBroadcastDraft,
  deleteBroadcastDraft,
  pauseBroadcast,
  queueBroadcast,
  resumeBroadcast,
  resumeLane,
  saveBroadcastDraft,
  type DraftPatch,
} from "@/lib/broadcasts/core";
import type { Json } from "@/lib/types/database";

/**
 * Las acciones de Broadcasts (docs/broadcasts.md). Cada una pide
 * `broadcasts.manage`; el workspace sale SIEMPRE de la sesión. La audiencia se
 * lee con el cliente de la persona (la RLS decide qué contactos ve) y se
 * escribe con el de servicio (la tabla no tiene políticas de escritura, 00285).
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NO_PERMISSION = { ok: false as const, error: "No tenés permiso para enviar broadcasts." };
const UUID = /^[0-9a-f-]{36}$/i;

function done(path = "/dashboard/broadcasts") {
  revalidatePath(path);
}

export async function createBroadcast(input: { name?: string; audienceQuery?: string }): Promise<Result<{ id: string }>> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  const query = typeof input.audienceQuery === "string" && input.audienceQuery.length <= 8000 ? input.audienceQuery : "";
  const service = await createServiceClient();
  const res = await createBroadcastDraft(service, {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    name: input.name,
    audienceParams: searchParamsToRecord(new URLSearchParams(query.replace(/^\?/, ""))),
  });
  if (!res.ok) return res;
  done();
  return { ok: true, id: res.value.id };
}

export async function saveBroadcast(id: string, patch: DraftPatch): Promise<Result> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  if (!UUID.test(id)) return { ok: false, error: "No encontré ese broadcast." };
  const service = await createServiceClient();
  return saveBroadcastDraft(service, ctx.workspace.id, id, patch ?? {});
}


/** Cuántos se alcanzan con estos filtros y este canal (lo que todavía no se guardó también vale). */
export async function previewBroadcastAudience(input: {
  audienceParams: unknown;
  channelId: string | null;
  includePhoneOnly: boolean;
}): Promise<Result<{ preview: AudiencePreview }>> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  if (!input.channelId || !UUID.test(input.channelId)) return { ok: false, error: "Elegí un canal para ver a cuántos les llega." };
  const service = await createServiceClient();
  const channel = await loadBroadcastChannel(service, ctx.workspace.id, input.channelId);
  if (!channel) return { ok: false, error: "Ese canal no está disponible para envíos masivos." };
  try {
    const audience = await resolveAudience(ctx.supabase, service, {
      workspaceId: ctx.workspace.id,
      params: sanitizeAudienceParams(input.audienceParams),
      channel,
      includePhoneOnly: channel.kind === "whatsapp" && input.includePhoneOnly === true,
      timeZone: await resolveViewerTimezone(ctx.workspace.timezone),
      collect: false,
      sampleSize: 50,
    });
    const skippedLabels = (Object.entries(audience.reach.skipped) as [AudienceSkipReason, number][])
      .filter(([reason]) => !(reason === "phone_only_excluded" && channel.kind !== "whatsapp"))
      .map(([reason, count]) => ({ reason, label: SKIP_REASON_LABELS[reason], count }))
      .sort((a, b) => b.count - a.count);
    return {
      ok: true,
      preview: {
        reach: audience.reach,
        skippedLabels,
        truncated: audience.truncated,
        sample: audience.sample.map((s) => ({
          contactId: s.contactId,
          name: s.displayName || "Sin nombre",
          ok: s.classification.ok,
          detail: s.classification.ok
            ? s.classification.linked
              ? s.classification.target
              : `${s.classification.target} (nunca escribió)`
            : SKIP_REASON_LABELS[s.classification.reason],
        })),
      },
    };
  } catch (e) {
    console.error("[broadcasts] vista previa de la audiencia fallida:", e instanceof Error ? e.message : "error");
    return { ok: false, error: "No pude contar la audiencia. Probá de nuevo." };
  }
}


/** El mensaje armado para contactos reales de la audiencia, y a cuántos les falta un dato. */
export async function previewBroadcastMessage(input: {
  broadcastId: string;
  audienceParams: unknown;
  channelId: string | null;
  includePhoneOnly: boolean;
  variants: unknown;
  emailSubject: string | null;
  emailPreheader?: string | null;
}): Promise<Result<{ preview: MessagePreview }>> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  if (!input.channelId || !UUID.test(input.channelId)) return { ok: false, error: "Elegí un canal primero." };
  const service = await createServiceClient();
  const channel = await loadBroadcastChannel(service, ctx.workspace.id, input.channelId);
  if (!channel) return { ok: false, error: "Ese canal no está disponible para envíos masivos." };
  const variants = cleanVariants(input.variants);
  if (variants.length === 0) return { ok: false, error: "Escribí el mensaje primero." };
  try {
    const audience = await resolveAudience(ctx.supabase, service, {
      workspaceId: ctx.workspace.id,
      params: sanitizeAudienceParams(input.audienceParams),
      channel,
      includePhoneOnly: channel.kind === "whatsapp" && input.includePhoneOnly === true,
      timeZone: await resolveViewerTimezone(ctx.workspace.timezone),
      collect: false,
      sampleSize: 400,
    });
    const sendable = audience.sample.filter((s) => s.classification.ok).slice(0, 200);
    const data = await loadRenderData(service, ctx.workspace.id, sendable.map((s) => s.contactId), audience.customFields);
    const samples: MessagePreview["samples"] = [];
    let missingCount = 0;
    for (const s of sendable) {
      const d = data.get(s.contactId);
      if (!d) continue;
      const vars = broadcastVariables(d.contact, { name: ctx.workspace.name }, audience.customFields, d.customValues);
      // La misma semilla que al poner en cola: a cada contacto le toca la misma variante que va a recibir.
      const variant = pickVariant(`${input.broadcastId}:${s.contactId}`, variants.length);
      const r =
        channel.kind === "email"
          ? (() => {
              const e = renderEmail(input.emailSubject ?? "", variants[0], vars, input.emailPreheader);
              return { subject: e.subject, preheader: e.preheader || null, text: e.html, missing: e.missing };
            })()
          : { subject: null, preheader: null, ...renderChatMessage(variants, variant, vars) };
      if (r.missing.length > 0) missingCount += 1;
      if (samples.length < 3) samples.push({ name: s.displayName || "Sin nombre", subject: r.subject, preheader: r.preheader, text: r.text, missing: r.missing });
    }
    return { ok: true, preview: { samples, missingCount, checked: sendable.length } };
  } catch (e) {
    console.error("[broadcasts] vista previa del mensaje fallida:", e instanceof Error ? e.message : "error");
    return { ok: false, error: "No pude armar la vista previa. Probá de nuevo." };
  }
}

export async function queueBroadcastAction(id: string): Promise<Result<{ sendable: number; skipped: number }>> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  if (!UUID.test(id)) return { ok: false, error: "No encontré ese broadcast." };
  const service = await createServiceClient();
  try {
    const res = await queueBroadcast(ctx.supabase, service, {
      workspaceId: ctx.workspace.id,
      id,
      timeZone: await resolveViewerTimezone(ctx.workspace.timezone),
    });
    if (!res.ok) return res;
    done();
    done(`/dashboard/broadcasts/${id}`);
    return { ok: true, ...res.value };
  } catch (e) {
    console.error("[broadcasts] no pude poner en cola:", e instanceof Error ? e.message : "error");
    return { ok: false, error: "No pude poner el broadcast en cola. Probá de nuevo." };
  }
}

export async function pauseBroadcastAction(id: string): Promise<Result> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  const res = await pauseBroadcast(await createServiceClient(), ctx.workspace.id, id);
  if (res.ok) done(`/dashboard/broadcasts/${id}`);
  return res;
}

export async function resumeBroadcastAction(id: string): Promise<Result> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  const res = await resumeBroadcast(await createServiceClient(), ctx.workspace.id, id);
  if (res.ok) done(`/dashboard/broadcasts/${id}`);
  return res;
}

export async function cancelBroadcastAction(id: string): Promise<Result> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  const res = await cancelBroadcast(await createServiceClient(), ctx.workspace.id, id);
  if (res.ok) done(`/dashboard/broadcasts/${id}`);
  return res;
}

export async function deleteBroadcastDraftAction(id: string): Promise<Result> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  const res = await deleteBroadcastDraft(await createServiceClient(), ctx.workspace.id, id);
  if (res.ok) done();
  return res;
}

/** Vuelve a habilitar los envíos por un número que se pausó solo (fallos seguidos). */
export async function resumeLaneAction(channelId: string): Promise<Result> {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NO_PERMISSION;
  if (!UUID.test(channelId)) return { ok: false, error: "No encontré ese canal." };
  return resumeLane(await createServiceClient(), ctx.workspace.id, channelId);
}

/** El techo de ritmo de un número de WhatsApp. Es configuración del canal: pide `channels.manage`. */
export async function saveChannelSendPolicy(channelId: string, raw: unknown): Promise<Result> {
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para configurar canales." };
  if (!UUID.test(channelId)) return { ok: false, error: "No encontré ese canal." };
  const service = await createServiceClient();
  const channel = await loadBroadcastChannel(service, ctx.workspace.id, channelId);
  if (!channel || channel.kind !== "whatsapp") return { ok: false, error: "El ritmo se configura en un número de WhatsApp." };
  const policy = parsePolicy(raw, DEFAULT_WHATSAPP_POLICY);
  const { error } = await service
    .from("channels")
    .update({ send_policy: policy as unknown as Json })
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[broadcasts] no pude guardar el ritmo del canal:", error.message);
    return { ok: false, error: "No pude guardar el ritmo. Probá de nuevo." };
  }
  revalidatePath("/dashboard/channels");
  return { ok: true };
}

/** El techo de ritmo guardado de un número (o el de siempre). */
export async function getChannelSendPolicy(channelId: string): Promise<Result<{ policy: SendPolicy }>> {
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para configurar canales." };
  if (!UUID.test(channelId)) return { ok: false, error: "No encontré ese canal." };
  const channel = await loadBroadcastChannel(await createServiceClient(), ctx.workspace.id, channelId);
  if (!channel || channel.kind !== "whatsapp") return { ok: false, error: "El ritmo se configura en un número de WhatsApp." };
  return { ok: true, policy: channel.policy };
}
