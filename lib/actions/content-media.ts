"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import {
  mediaPath,
  pathBelongsToWorkspace,
  removalPlan,
  validateMedia,
  type MediaEntry,
} from "@/lib/content/media";

/**
 * Subir y sacar media de una pieza (F18).
 *
 * La subida NO pasa por el servidor: un video de 1 GB no entra en una Server
 * Action, y con TUS va en partes. Lo que hace el servidor es decidir si ese
 * archivo se puede subir y devolver a donde.
 *
 * Por eso la validacion mira los PRIMEROS BYTES y no la extension: el cliente
 * manda la cabecera del archivo, el servidor la reconoce, y solo entonces
 * autoriza una ruta. Aunque alguien se saltee esto, la policy del bucket
 * limita a que la ruta empiece con su workspace y el bucket rechaza los MIME
 * que no estan permitidos.
 */

const CONTENT_PATH = "/dashboard/content";

export type MediaActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

export interface UploadTicket {
  /** Donde va el archivo dentro del bucket. */
  path: string;
  /** Tipo real, el que hay que declarar al subir. */
  mime: string;
  /** Si conviene subir por partes. */
  resumable: boolean;
  /** Firma para la subida simple. Null cuando va por TUS. */
  token: string | null;
}

/**
 * Autoriza una subida y dice a donde.
 *
 * `head` son los primeros bytes en base64: alcanza con 16.
 */
export async function requestMediaUpload(input: {
  postId: string;
  fileName: string;
  sizeBytes: number;
  headBase64: string;
  declaredMime?: string;
}): Promise<MediaActionResult<UploadTicket>> {
  const { workspace, supabase } = await getWorkspace();

  // Que la pieza exista y sea de este workspace. La RLS ya lo garantiza, pero
  // si no existe conviene decirlo antes de firmar una ruta hacia la nada.
  const { data: post } = await supabase
    .from("content_posts")
    .select("id")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const checked = validateMedia({
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    head: new Uint8Array(Buffer.from(input.headBase64, "base64")),
    declaredMime: input.declaredMime,
  });

  if (!checked.ok) return checked;

  const path = mediaPath({
    workspaceId: workspace.id,
    postId: input.postId,
    ext: checked.ext,
    uniqueId: randomUUID(),
  });

  if (checked.resumable) {
    // TUS sube con el token de la sesion de quien esta en la pantalla: no
    // hace falta firmar nada, y la policy del bucket decide.
    return { ok: true, data: { path, mime: checked.mime, resumable: true, token: null } };
  }

  const { data, error } = await supabase.storage
    .from("content-media")
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[content] no pude firmar la subida:", error?.message);
    return { ok: false, error: "No pude preparar la subida" };
  }

  return { ok: true, data: { path, mime: checked.mime, resumable: false, token: data.token } };
}

/** Anota en la pieza un archivo que ya se subio. */
export async function attachMedia(input: {
  postId: string;
  path: string;
  mime: string;
  kind: MediaEntry["kind"];
  sizeBytes: number;
  isCover?: boolean;
  altText?: string | null;
  /**
   * La media propia de una red (C8): va dentro de `networks[].media` en vez
   * de la de la pieza. Sin esto, la variante solo se podia armar tocando el
   * jsonb a mano.
   */
  platform?: string | null;
}): Promise<MediaActionResult> {
  const { workspace, supabase } = await getWorkspace();

  if (!pathBelongsToWorkspace(input.path, workspace.id)) {
    return { ok: false, error: "Esa ruta no es de este workspace" };
  }

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, media, networks")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const entry: MediaEntry = {
    storage_path: input.path,
    mime_type: input.mime,
    kind: input.kind,
    size_bytes: input.sizeBytes,
    is_cover: input.isCover ?? false,
    alt_text: input.altText ?? null,
  };

  const patch = input.platform
    ? {
        networks: patchNetworkMedia(post.networks, input.platform, (media) => [
          ...media,
          entry,
        ]) as never,
      }
    : {
        media: [
          ...((Array.isArray(post.media) ? post.media : []) as unknown as MediaEntry[]),
          entry,
        ] as never,
      };

  const { error } = await supabase.from("content_posts").update(patch).eq("id", input.postId);

  if (error) return { ok: false, error: "No pude guardar la media en la pieza" };

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

/** Cambia la media de UNA red dentro del jsonb, sin tocar el resto. */
function patchNetworkMedia(
  networks: unknown,
  platform: string,
  change: (media: MediaEntry[]) => MediaEntry[],
): unknown[] {
  const list = (Array.isArray(networks) ? networks : []) as Array<{
    platform?: string;
    media?: unknown[] | null;
  }>;

  return list.map((n) =>
    n.platform === platform
      ? { ...n, media: change((Array.isArray(n.media) ? n.media : []) as MediaEntry[]) }
      : n,
  );
}

/**
 * Saca una media de la pieza.
 *
 * Si la pieza no se publico, el archivo se borra del bucket; si ya salio, se
 * marca y se conserva (`removalPlan`). El borrado usa el service client
 * porque la policy solo deja borrar a Owner/Admin y esta accion ya decidio
 * que corresponde.
 */
export async function removeMedia(input: {
  postId: string;
  path: string;
  /** La media propia de una red (C8). */
  platform?: string | null;
}): Promise<MediaActionResult> {
  const { workspace, supabase } = await getWorkspace();

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, media, networks, status")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const current = input.platform
    ? ((
        (Array.isArray(post.networks) ? post.networks : []) as Array<{
          platform?: string;
          media?: unknown[] | null;
        }>
      ).find((n) => n.platform === input.platform)?.media ?? []) as unknown as MediaEntry[]
    : ((Array.isArray(post.media) ? post.media : []) as unknown as MediaEntry[]);

  const published = ["published", "partially_published", "publishing"].includes(post.status);
  const plan = removalPlan({
    media: current,
    storagePath: input.path,
    postPublished: published,
  });

  if (!plan.found) return { ok: false, error: "Esa media ya no esta en la pieza" };

  const { error } = await supabase
    .from("content_posts")
    .update(
      input.platform
        ? {
            networks: patchNetworkMedia(
              post.networks,
              input.platform,
              () => plan.media as MediaEntry[],
            ) as never,
          }
        : { media: plan.media as never },
    )
    .eq("id", input.postId);

  if (error) return { ok: false, error: "No pude actualizar la pieza" };

  if (plan.deleteFromBucket) {
    const service = await createServiceClient();
    const { error: storageError } = await service.storage
      .from("content-media")
      .remove([input.path]);
    // Que quede un archivo huerfano es menos grave que dejar la pieza
    // apuntando a algo que ya no existe: el cron de limpieza lo barre.
    if (storageError) {
      console.error("[content] no pude borrar el archivo:", storageError.message);
    }
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}
