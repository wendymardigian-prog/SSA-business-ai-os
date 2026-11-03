"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMemberAction, getPermissionAction } from "@/lib/auth/guards";
import { grantFor, canWriteWhatsappGroup } from "@/lib/auth/channel-permissions";
import { sniffUploadMime } from "@/lib/content/media";
import { CHAT_MEDIA_BUCKET, MAX_CHAT_UPLOAD_BYTES, extensionForMime, isSafeStoragePath } from "@/lib/chat-media/bucket";
import { MAX_FLOW_NAME_LENGTH } from "@/lib/flows/categories";
import { validatePoll, type PollDraft } from "@/lib/whatsapp-groups/poll";
import { sendToGroup, type GroupSendTarget } from "@/lib/whatsapp-groups/send";
import { groupMediaFolder } from "@/lib/whatsapp-groups/rules";
import { automationFromMessage } from "@/lib/whatsapp-groups/automation/from-message";
import type { Json } from "@/lib/types/database";

/**
 * La bandeja de grupos de WhatsApp (00280): escribir, mandar un archivo o una encuesta, marcar como leido y
 * «Crear automatización» desde un mensaje.
 *
 * El grupo se lee SIEMPRE con el cliente del USUARIO (la RLS, `can_see_whatsapp_group`, decide si lo ve) y escribir
 * pide ademas «responde» en esa cuenta (`canWriteWhatsappGroup`, gemela de `can_write_whatsapp_group`). Recien
 * despues se escribe con el cliente de servicio. El workspace sale de la sesion, nunca del pedido.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "No encontré ese grupo.";
const CANT_WRITE = "Tu rol no puede escribir por este número.";
const MAX_TEXT = 4096;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function loadGroup(groupId: string, write: boolean) {
  if (!UUID.test(groupId ?? "")) return { error: NOT_FOUND } as const;
  const supabase = await createClient();
  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("id, workspace_id, channel_id, group_jid, subject, in_inbox, left_at")
    .eq("id", groupId)
    .maybeSingle();
  if (!group || group.left_at) return { error: NOT_FOUND } as const;
  const access = await getMemberAction();
  if (!access || access.workspace.id !== group.workspace_id) return { error: NOT_FOUND } as const;
  if (write) {
    const admin = access.role === "owner" || access.role === "admin";
    if (!group.in_inbox || (!admin && !canWriteWhatsappGroup(grantFor(access.permissions?.channels, group.channel_id)))) {
      return { error: CANT_WRITE } as const;
    }
  }
  return { group, access, service: await createServiceClient() } as const;
}

function target(group: { id: string; workspace_id: string; channel_id: string; group_jid: string }): GroupSendTarget {
  return { id: group.id, workspace_id: group.workspace_id, channel_id: group.channel_id, group_jid: group.group_jid };
}

/** Un texto (o un archivo ya subido, con el texto como pie). */
export async function sendGroupMessage(
  groupId: string,
  input: { text?: string; media?: { storagePath: string; kind: "image" | "video" | "document"; mime: string; filename: string | null } | null },
): Promise<Result<{ messageId: string | null }>> {
  const text = (input?.text ?? "").trim();
  if (text.length > MAX_TEXT) return { ok: false, error: `El mensaje puede tener hasta ${MAX_TEXT} caracteres.` };
  if (!text && !input?.media) return { ok: false, error: "El mensaje está vacío." };
  const loaded = await loadGroup(groupId, true);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const { group, access, service } = loaded;

  let media = input.media ?? null;
  if (media) {
    // El archivo tiene que ser de la carpeta de ESTE grupo y ser lo que dice ser.
    if (!isSafeStoragePath(media.storagePath) || !media.storagePath.startsWith(`${group.workspace_id}/${groupMediaFolder(group.id)}/`)) {
      return { ok: false, error: "El archivo no pertenece a este grupo." };
    }
    const { data: file } = await service.storage.from(CHAT_MEDIA_BUCKET).download(media.storagePath);
    if (!file) return { ok: false, error: "No pude leer el archivo subido." };
    const sniffed = sniffUploadMime(new Uint8Array(await file.arrayBuffer()), media.mime);
    if (!sniffed) return { ok: false, error: "El archivo no se pudo reconocer." };
    media = { ...media, mime: sniffed, kind: sniffed.startsWith("image/") ? "image" : sniffed.startsWith("video/") ? "video" : "document" };
  }

  const result = await sendToGroup(service, target(group), { text, media }, { userId: access.user.id });
  revalidatePath("/dashboard/inbox");
  return result.ok ? { ok: true, messageId: result.messageId } : { ok: false, error: result.error };
}

/** Una encuesta al grupo. */
export async function sendGroupPoll(groupId: string, draft: PollDraft): Promise<Result<{ messageId: string | null }>> {
  const validation = validatePoll(draft);
  if (!validation.ok) return { ok: false, error: validation.error };
  const loaded = await loadGroup(groupId, true);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  const result = await sendToGroup(loaded.service, target(loaded.group), { poll: validation.poll }, { userId: loaded.access.user.id });
  revalidatePath("/dashboard/inbox");
  return result.ok ? { ok: true, messageId: result.messageId } : { ok: false, error: result.error };
}

/** Autoriza la subida de un archivo para mandar al grupo (directo del navegador al bucket, como en el chat). */
export async function requestGroupUpload(
  groupId: string,
  input: { sizeBytes: number; headBase64: string; declaredMime?: string },
): Promise<Result<{ path: string; mime: string; token: string }>> {
  const loaded = await loadGroup(groupId, true);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  if (!(input?.sizeBytes > 0)) return { ok: false, error: "El archivo está vacío" };
  if (input.sizeBytes > MAX_CHAT_UPLOAD_BYTES) return { ok: false, error: "El archivo pesa más de 16 MB" };
  const mime = sniffUploadMime(new Uint8Array(Buffer.from(input.headBase64 ?? "", "base64")), input.declaredMime);
  if (!mime) return { ok: false, error: "No reconozco ese tipo de archivo." };
  if (mime.startsWith("audio/")) return { ok: false, error: "Por ahora a un grupo se mandan fotos, videos y archivos (no audios)." };
  const path = `${loaded.group.workspace_id}/${groupMediaFolder(loaded.group.id)}/out-${randomUUID()}.${extensionForMime(mime)}`;
  const { data, error } = await loaded.service.storage.from(CHAT_MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "No pude preparar la subida" };
  return { ok: true, path, mime, token: data.token };
}

/** Abrir el grupo lo marca como leido. */
export async function markGroupRead(groupId: string): Promise<Result> {
  const loaded = await loadGroup(groupId, false);
  if ("error" in loaded) return { ok: false, error: loaded.error ?? NOT_FOUND };
  await loaded.service.from("whatsapp_groups").update({ unread_count: 0 }).eq("id", loaded.group.id);
  return { ok: true };
}

/** «Crear automatización» desde un mensaje o una encuesta del grupo: nace en borrador con el disparador armado. */
export async function createAutomationFromGroupMessage(input: {
  messageId: string;
  kind: "reaction" | "poll_vote";
  emojis?: string[];
  options?: string[];
}): Promise<Result<{ flowId: string }>> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para crear automatizaciones." };
  if (!UUID.test(input?.messageId ?? "") || (input.kind !== "reaction" && input.kind !== "poll_vote")) return { ok: false, error: "Pedido inválido." };

  // El mensaje se lee con la sesion: si no ve el grupo, no hay mensaje.
  const supabase = await createClient();
  const { data: message } = await supabase
    .from("whatsapp_group_messages")
    .select("id, group_id, workspace_id, text, poll")
    .eq("id", input.messageId)
    .maybeSingle();
  if (!message || message.workspace_id !== ctx.workspace.id) return { ok: false, error: "No encontré ese mensaje." };
  if (input.kind === "poll_vote" && !message.poll) return { ok: false, error: "Ese mensaje no es una encuesta." };
  const { data: group } = await supabase.from("whatsapp_groups").select("subject").eq("id", message.group_id).maybeSingle();

  const poll = message.poll && typeof message.poll === "object" ? (message.poll as { name?: unknown }) : null;
  const built = automationFromMessage(
    { kind: input.kind, groupId: message.group_id, messageId: message.id, emojis: input.emojis, options: input.options },
    { groupName: group?.subject ?? "el grupo", messageLabel: poll ? String(poll.name ?? "") : (message.text ?? "").trim() || "mensaje" },
  );

  const { data: flow, error } = await ctx.supabase
    .from("flows")
    .insert({ workspace_id: ctx.workspace.id, name: built.name.slice(0, MAX_FLOW_NAME_LENGTH), nodes: built.nodes as unknown as Json, edges: [], categories: ["Grupos de WhatsApp"] })
    .select("id")
    .single();
  if (error || !flow) {
    console.error("[grupos] no pude crear la automatizacion:", error?.message);
    return { ok: false, error: "No pude crear la automatización. Probá de nuevo." };
  }
  revalidatePath("/dashboard/flows");
  return { ok: true, flowId: flow.id };
}
