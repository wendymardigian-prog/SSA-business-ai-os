"use server";
// @plantilla-quitar(servicios)

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { svcRpc, type SvcResult } from "@/lib/services/db";

/**
 * La comunidad del programa desde SSA (bloque CO, F77, F111). Cada acción pide su clave y la base la vuelve a pedir
 * con la sesión: `community.reply` (publicar, responder, marcar como visto), `community.moderate` (fijar, ocultar,
 * borrar, silenciar, resolver reportes). Los espacios se guardan con `saveProgramSettings` (`community.spaces`).
 */

const NOT_ALLOWED = { ok: false as const, error: { code: "SV004", message: "No tenés permiso para hacer esto", detail: null } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refresh = (productId: string) => revalidatePath(`/dashboard/portal/${productId}`, "layout"); // también sus ajustes

export async function communityTeamPost(productId: string, input: { body: string; spaceKey?: string | null; parentId?: string | null; programItemId?: string | null; asBusiness?: boolean }): Promise<SvcResult<string>> {
  const ctx = await getPermissionAction("community.reply");
  if (!ctx || !UUID.test(productId) || (input.parentId && !UUID.test(input.parentId)) || (input.programItemId && !UUID.test(input.programItemId))) return NOT_ALLOWED;
  const body = input.body.trim().slice(0, 10000);
  if (!body) return { ok: false, error: { code: "CO002", message: "Escribí el mensaje", detail: null } };
  const res = await svcRpc<string>(ctx.supabase, "community_team_post", {
    p_product_id: productId,
    p: { body, space_key: input.spaceKey ?? null, parent_id: input.parentId ?? null, program_item_id: input.programItemId ?? null, as_business: input.asBusiness === true },
  });
  if (res.ok) refresh(productId);
  return res;
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
