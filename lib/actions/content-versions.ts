"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import {
  nextVersionNumber,
  versionReasonFor,
  versionsToPrune,
  type PostSnapshot,
  type SaveContext,
} from "@/lib/content/versions";

/**
 * El historial de una pieza (F22).
 *
 * Las versiones las escribe el SERVIDOR con el service client, no el
 * navegador: la tabla solo tiene policy de lectura (00083). Es a proposito,
 * porque el historial pierde sentido si alguien puede escribirlo a mano.
 */

const CONTENT_PATH = "/dashboard/content";

export type VersionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/**
 * Guarda una version, si esta escritura la merece.
 *
 * Devuelve `saved: false` cuando no correspondia (un autoguardado normal), que
 * no es un error.
 */
export async function saveVersion(input: {
  postId: string;
  context: SaveContext;
  authorKind?: "human" | "ai" | "system";
}): Promise<VersionResult<{ saved: boolean; versionNo?: number }>> {
  const reason = versionReasonFor(input.context);
  if (!reason) return { ok: true, data: { saved: false } };

  const { workspace, user, supabase } = await getWorkspace();

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, title, format, copy, caption, networks, media, current_version")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const snapshot: PostSnapshot = {
    title: post.title,
    format: post.format,
    copy: (post.copy ?? {}) as Record<string, unknown>,
    caption: post.caption,
    networks: (Array.isArray(post.networks) ? post.networks : []) as unknown[],
    media: (Array.isArray(post.media) ? post.media : []) as unknown[],
  };

  const versionNo = nextVersionNumber(post.current_version ?? 0);
  const service = await createServiceClient();

  const { error } = await service.from("content_post_versions").insert({
    workspace_id: workspace.id,
    post_id: post.id,
    version_no: versionNo,
    snapshot: snapshot as never,
    author_kind: input.authorKind ?? "human",
    author_id: input.authorKind === "ai" ? null : user.id,
    reason,
  });

  if (error) {
    console.error("[content] no pude guardar la version:", error.message);
    return { ok: false, error: "No pude guardar la version" };
  }

  await service.from("content_posts").update({ current_version: versionNo }).eq("id", post.id);

  // El recorte va despues de guardar: perder la version nueva por limpiar
  // seria al reves de lo que se quiere.
  const { data: all } = await service
    .from("content_post_versions")
    .select("id, version_no")
    .eq("post_id", post.id);

  const extra = versionsToPrune(all ?? []);
  if (extra.length > 0) {
    await service.from("content_post_versions").delete().in("id", extra);
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { saved: true, versionNo } };
}

/**
 * Restaura una version.
 *
 * Crea una version nueva con lo que hay AHORA antes de pisar nada: restaurar
 * no puede ser la forma de perder el trabajo de hoy. Despues escribe el
 * contenido viejo sobre la pieza.
 */
export async function restoreVersion(input: {
  postId: string;
  versionId: string;
}): Promise<VersionResult> {
  const { workspace, supabase } = await getWorkspace();

  const { data: version } = await supabase
    .from("content_post_versions")
    .select("id, post_id, snapshot")
    .eq("id", input.versionId)
    .eq("post_id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!version) return { ok: false, error: "No encontre esa version" };

  const guardado = await saveVersion({
    postId: input.postId,
    context: { trigger: "restore" },
  });
  if (!guardado.ok) return guardado;

  const snapshot = version.snapshot as unknown as PostSnapshot;

  const { error } = await supabase
    .from("content_posts")
    .update({
      title: snapshot.title,
      format: snapshot.format,
      copy: snapshot.copy as never,
      caption: snapshot.caption,
      networks: snapshot.networks as never,
      media: snapshot.media as never,
    })
    .eq("id", input.postId);

  if (error) {
    console.error("[content] no pude restaurar:", error.message);
    return { ok: false, error: "No pude restaurar esa version" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}
