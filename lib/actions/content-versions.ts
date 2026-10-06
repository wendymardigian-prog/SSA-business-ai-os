"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { writeVersion } from "@/lib/content/save-version";
import { normalizeSnapshot, type SaveContext, type StoredSnapshot } from "@/lib/content/versions";

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
  const { workspace, user } = await getWorkspace();
  const service = await createServiceClient();

  const result = await writeVersion(service, {
    postId: input.postId,
    workspaceId: workspace.id,
    context: input.context,
    authorKind: input.authorKind,
    authorId: user.id,
  });

  if (!result.ok) return result;

  revalidatePath(CONTENT_PATH);
  return {
    ok: true,
    data: result.saved ? { saved: true, versionNo: result.versionNo } : { saved: false },
  };
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

  // Una version vieja guarda `copy`; se lleva a la forma nueva y se escribe
  // `script`. La columna `copy` NO se toca nunca mas (F90).
  const snapshot = normalizeSnapshot(version.snapshot as unknown as StoredSnapshot);

  const { error } = await supabase
    .from("content_posts")
    .update({
      title: snapshot.title,
      format: snapshot.format,
      script: snapshot.script,
      recording_notes: snapshot.recording_notes,
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
