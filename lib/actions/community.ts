"use server";
// @plantilla-quitar(servicios)

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { sniffMime } from "@/lib/content/media";
import { svcRpc, type SvcResult } from "@/lib/services/db";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveBrand } from "@/lib/brand";
import { isEmailConfigured } from "@/lib/email/send";
import { COMMUNITY_POST_EMAIL_JOB } from "@/lib/jobs/handlers/community-post-email";
import { COMMUNITY_MEDIA_BUCKET, COMMUNITY_PHOTO_MAX_BYTES, COMMUNITY_TITLE_MAX, MAX_COMMUNITY_PHOTOS, teamMediaPath } from "@/lib/program/community-text";

/**
 * La comunidad del programa desde SSA (bloque CO, F77, F111). Cada acción pide su clave y la base la vuelve a pedir
 * con la sesión: `community.reply` (publicar, responder, marcar como visto), `community.moderate` (fijar, ocultar,
 * borrar, silenciar, resolver reportes). Los espacios se guardan con `saveProgramSettings` (`community.spaces`).
 *
 * El texto va en Markdown acotado (`lib/program/community-text.ts`) y las fotos del equipo se suben al bucket
 * `community-media` (`communityUploadPhoto`) y viajan como `media: [{path}]` (00401).
 *
 * 00405: un post nuevo del equipo lleva título (hasta 200, con emojis) y, con `notifyEmail`, un aviso por correo a los
 * estudiantes con cuenta activa (`lib/jobs/handlers/community-post-email.ts`). Encolar el aviso nunca tumba el post.
 */

const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refresh = (productId: string) => revalidatePath(`/dashboard/portal/${productId}`, "layout"); // también sus ajustes

const TOO_LONG = { ok: false as const, error: { code: "CO002", message: "El texto es muy largo (hasta 10.000 caracteres, contando el formato)", detail: null } };
const EMPTY = { ok: false as const, error: { code: "CO002", message: "Escribí el mensaje", detail: null } };
const NO_TITLE = { ok: false as const, error: { code: "CO002", message: "Escribí el título", detail: null } };
const TITLE_TOO_LONG = { ok: false as const, error: { code: "CO002", message: "El título va hasta 200 caracteres", detail: null } };
const mediaOf = (paths: string[] | undefined) => (paths ?? []).filter((p) => typeof p === "string").slice(0, MAX_COMMUNITY_PHOTOS).map((path) => ({ path }));

export async function communityTeamPost(
  productId: string,
  input: {
    body: string;
    /** Obligatorio en un post nuevo; una respuesta no lleva. */
    title?: string;
    /** Avisar por correo a los estudiantes (solo un post nuevo). */
    notifyEmail?: boolean;
    spaceKey?: string | null;
    parentId?: string | null;
    programItemId?: string | null;
    asBusiness?: boolean;
    media?: string[];
    communityKeys?: string[];
  },
): Promise<SvcResult<string> & { email?: { recipients: number; warning: string | null } }> {
  const ctx = await getPermissionAction("community.reply");
  if (!ctx || !UUID.test(productId) || (input.parentId && !UUID.test(input.parentId)) || (input.programItemId && !UUID.test(input.programItemId))) return NOT_ALLOWED;
  // En qué comunidades (00402): sin elegir, la principal; una respuesta va siempre en la de su post (lo decide la base).
  const keys = (input.communityKeys ?? []).filter((k) => /^[a-z0-9_]{1,40}$/.test(k)).slice(0, 20);
  const body = input.body.trim();
  if (!body) return EMPTY;
  if (body.length > 10000) return TOO_LONG;
  const title = input.parentId ? null : (input.title ?? "").trim();
  if (title !== null && !title) return NO_TITLE;
  if (title && title.length > COMMUNITY_TITLE_MAX) return TITLE_TOO_LONG;
  const res = await svcRpc<string>(ctx.supabase, "community_team_post", {
    p_product_id: productId,
    p: {
      body,
      ...(title ? { title } : {}),
      space_key: input.spaceKey ?? null,
      parent_id: input.parentId ?? null,
      program_item_id: input.programItemId ?? null,
      as_business: input.asBusiness === true,
      media: mediaOf(input.media),
      ...(keys.length && !input.parentId ? { community_keys: keys } : {}),
    },
  });
  if (!res.ok) return res;
  refresh(productId);
  if (!input.notifyEmail || input.parentId) return res;
  const email = await enqueuePostEmail(ctx, productId, res.data, keys, input.asBusiness === true);
  return { ...res, email };
}

/**
 * Encola el reparto del aviso por correo (un job; el reparto encola un envío por persona). Cuenta antes a quiénes les
 * llega para decirlo en pantalla. Nunca lanza: un problema vuelve como aviso y el post ya quedó publicado.
 */
async function enqueuePostEmail(
  ctx: NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>,
  productId: string,
  postId: string,
  keys: string[],
  asBusiness: boolean,
): Promise<{ recipients: number; warning: string | null }> {
  try {
    const service = await createServiceClient();
    const [targets, configured] = await Promise.all([
      svcRpc<Array<{ contact_id: string }>>(service, "community_email_targets", { p_product_id: productId, p_keys: keys.length ? keys : null }),
      isEmailConfigured(service as never, ctx.workspace.id),
    ]);
    if (!targets.ok) {
      console.error("[community] no pude contar los destinatarios:", targets.error.message);
      return { recipients: 0, warning: "Se publicó, pero no pude mandar el correo. Probá publicar de nuevo más tarde o avisá a soporte." };
    }
    const recipients = targets.data?.length ?? 0;
    if (recipients === 0) return { recipients, warning: "Se publicó. No hay estudiantes con la cuenta del portal activa para avisarles por correo." };
    if (!configured) return { recipients: 0, warning: "Se publicó, pero el correo no salió: falta conectar Resend en Ajustes → Integraciones." };
    const meta = ctx.user.user_metadata as { full_name?: string; name?: string } | undefined;
    const brandName = resolveBrand(ctx.workspace as never).name;
    const author = asBusiness ? brandName : meta?.full_name?.trim() || meta?.name?.trim() || brandName;
    const { error } = await service.from("scheduled_jobs").insert({
      type: COMMUNITY_POST_EMAIL_JOB,
      payload: { workspace_id: ctx.workspace.id, product_id: productId, post_id: postId, community_keys: keys, author_label: author },
      run_at: new Date().toISOString(),
      status: "pending" as const,
      dedupe_key: `community_post_email:${postId}`,
    });
    if (error && error.code !== "23505") {
      console.error("[community] no pude encolar el correo:", error.message);
      return { recipients: 0, warning: "Se publicó, pero no pude mandar el correo. Avisá a soporte." };
    }
    return { recipients, warning: null };
  } catch (e) {
    console.error("[community] el correo de la publicación falló:", e instanceof Error ? e.message : "error");
    return { recipients: 0, warning: "Se publicó, pero no pude mandar el correo. Avisá a soporte." };
  }
}

/** Editar un post del equipo (texto y fotos). La base decide quién puede: quien lo escribió o quien modera. */
export async function communityTeamEdit(productId: string, postId: string, input: { body: string; media: string[]; title?: string }): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("community.reply");
  if (!ctx || !UUID.test(productId) || !UUID.test(postId)) return NOT_ALLOWED;
  const body = input.body.trim();
  if (!body) return EMPTY;
  if (body.length > 10000) return TOO_LONG;
  // Editar nunca vuelve a mandar el correo. Sin `title`, el título queda como estaba (la base lo decide).
  const title = input.title === undefined ? undefined : input.title.trim();
  if (title && title.length > COMMUNITY_TITLE_MAX) return TITLE_TOO_LONG;
  const res = await svcRpc<null>(ctx.supabase, "community_team_edit", { p_post_id: postId, p: { body, media: mediaOf(input.media), ...(title !== undefined ? { title } : {}) } });
  if (res.ok) refresh(productId);
  return res;
}

/**
 * Sube una foto para un post del equipo (campos `productId` y `file`). Valida por los BYTES (PNG, JPG, WEBP o GIF) y
 * el tope de 10 MB, y devuelve el path y un link firmado de una hora para verla antes de publicar.
 */
export async function communityUploadPhoto(formData: FormData): Promise<SvcResult<{ path: string; url: string }>> {
  const ctx = await getPermissionAction("community.reply");
  const productId = String(formData.get("productId") ?? "");
  const file = formData.get("file");
  if (!ctx || !UUID.test(productId) || !(file instanceof File)) return NOT_ALLOWED;
  const { data: product } = await ctx.supabase.from("products").select("id").eq("id", productId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!product) return NOT_ALLOWED;
  if (file.size > COMMUNITY_PHOTO_MAX_BYTES) return { ok: false, error: { code: "CO002", message: "La foto pesa más de 10 MB", detail: null } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : null;
  if (!ext || !mime) return { ok: false, error: { code: "CO002", message: "La foto tiene que ser PNG, JPG, WEBP o GIF", detail: null } };
  const path = teamMediaPath({ workspaceId: ctx.workspace.id, productId, fileId: randomUUID(), ext });
  const service = await createServiceClient();
  const { error } = await service.storage.from(COMMUNITY_MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (error) {
    console.error("[community] no pude subir la foto:", error.message);
    return { ok: false, error: { code: "CO002", message: "No pude subir la foto. Probá de nuevo.", detail: null } };
  }
  const { data: signed } = await service.storage.from(COMMUNITY_MEDIA_BUCKET).createSignedUrl(path, 3600);
  return { ok: true, data: { path, url: signed?.signedUrl ?? "" } };
}

export async function communityMarkSeen(productId: string, postId: string, seen = true): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("community.reply");
  if (!ctx || !UUID.test(postId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "community_mark_seen", { p_post_id: postId, p_seen: seen });
  if (res.ok) refresh(productId);
  return res;
}

export async function communityModerate(productId: string, postId: string, action: "pin" | "unpin" | "hide" | "unhide" | "delete", reason?: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("community.moderate");
  if (!ctx || !UUID.test(postId) || !["pin", "unpin", "hide", "unhide", "delete"].includes(action)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "community_moderate", { p_post_id: postId, p_action: action, p_reason: reason?.trim() || null });
  if (res.ok) refresh(productId);
  return res;
}

export async function communitySetMuted(productId: string, contactId: string, muted: boolean, reason?: string): Promise<SvcResult<number>> {
  const ctx = await getPermissionAction("community.moderate");
  if (!ctx || !UUID.test(productId) || !UUID.test(contactId)) return NOT_ALLOWED;
  const res = await svcRpc<number>(ctx.supabase, "community_set_muted", { p_product_id: productId, p_contact_id: contactId, p_muted: muted, p_reason: reason?.trim() || null });
  if (res.ok) refresh(productId);
  return res;
}

export async function communityResolveReport(productId: string, reactionId: string): Promise<SvcResult<null>> {
  const ctx = await getPermissionAction("community.moderate");
  if (!ctx || !UUID.test(reactionId)) return NOT_ALLOWED;
  const res = await svcRpc<null>(ctx.supabase, "community_resolve_report", { p_reaction_id: reactionId });
  if (res.ok) refresh(productId);
  return res;
}
