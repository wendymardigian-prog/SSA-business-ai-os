/**
 * La media tiene que vivir en Zernio antes de programar (D5).
 *
 * Nuestros links de Storage son firmados y vencen en 24 horas. Sirven para
 * "publica ahora", pero no para un post agendado el martes que sale el
 * viernes: Zernio lo iria a buscar y encontraria un link muerto.
 *
 * Asi que al programar se sube el archivo a Zernio y se usa la direccion
 * publica que devuelve. Y se anota cual es cual en `provider_media`, porque
 * la misma pieza se programa en varias redes y subir el mismo video tres
 * veces es tirar tiempo y cuota.
 *
 * El mismo baile que hace `use-media.ts` de LateWiz, pero del lado del
 * servidor: pedir la URL prefirmada, PUT del archivo, quedarse con la
 * publica.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { MediaEntry } from "@/lib/content/media";
import type { FetchLike } from "@/lib/oauth/types";
import { PublishError } from "@/lib/jobs/errors";
import { classifyZernioError } from "./zernio-errors";

type Db = SupabaseClient<Database>;

export const ZERNIO_PUBLISHER = "zernio";

/** Lo que necesita este modulo del cliente de Zernio, y nada mas. */
export interface ZernioMediaClient {
  media: {
    getMediaPresignedUrl(options: {
      body: { filename: string; contentType: string; size?: number };
    }): Promise<{ data?: { uploadUrl?: string; publicUrl?: string } | null; error?: unknown }>;
  };
}

export interface EnsureMediaParams {
  workspaceId: string;
  client: ZernioMediaClient;
  /** La media de la pieza, en orden. */
  media: MediaEntry[];
  /** Los links firmados de esa misma media, en el mismo orden. */
  signedUrls: string[];
  fetchImpl?: FetchLike;
}

/** El nombre con el que se sube: Zernio lo usa para la extension. */
function filenameOf(path: string): string {
  const last = path.split("/").pop() ?? "archivo";
  return last || "archivo";
}

/**
 * Sube lo que falte y devuelve las URLs de Zernio, en el mismo orden que la
 * media recibida.
 *
 * Lanza un `PublishError` si algo no se puede subir: publicar con la mitad
 * de las fotos es peor que no publicar.
 */
export async function ensureMediaInZernio(
  supabase: Db,
  params: EnsureMediaParams,
): Promise<string[]> {
  const { workspaceId, client, media, signedUrls } = params;
  const impl = params.fetchImpl ?? fetch;

  if (media.length === 0) return [];
  if (media.length !== signedUrls.length) {
    throw new PublishError("No pude preparar toda la media para publicar", "temporary");
  }

  const paths = media.map((m) => m.storage_path);
  const { data: cached } = await supabase
    .from("provider_media")
    .select("storage_path, size_bytes, provider_url")
    .eq("workspace_id", workspaceId)
    .eq("publisher", ZERNIO_PUBLISHER)
    .in("storage_path", paths);

  const known = new Map(
    (cached ?? []).map((row) => [row.storage_path, row]),
  );

  const out: string[] = [];

  for (let i = 0; i < media.length; i++) {
    const entry = media[i];
    const hit = known.get(entry.storage_path);

    // El tamano es la senal mas barata de que el archivo cambio. Si cambio,
    // la copia de Zernio es de otra cosa y hay que subirla de nuevo.
    if (hit && (hit.size_bytes === null || Number(hit.size_bytes) === entry.size_bytes)) {
      out.push(hit.provider_url);
      continue;
    }

    out.push(await uploadOne(supabase, workspaceId, client, impl, entry, signedUrls[i]));
  }

  return out;
}

async function uploadOne(
  supabase: Db,
  workspaceId: string,
  client: ZernioMediaClient,
  impl: FetchLike,
  entry: MediaEntry,
  signedUrl: string,
): Promise<string> {
  let presigned: { uploadUrl?: string; publicUrl?: string } | null | undefined;

  try {
    const result = await client.media.getMediaPresignedUrl({
      body: {
        filename: filenameOf(entry.storage_path),
        contentType: entry.mime_type,
        size: entry.size_bytes,
      },
    });
    presigned = result.data;
  } catch (err) {
    throw classifyZernioError(err, "Zernio no me dio donde subir la media");
  }

  if (!presigned?.uploadUrl || !presigned.publicUrl) {
    throw new PublishError("Zernio no me dio donde subir la media", "temporary");
  }

  // Del bucket a Zernio, sin pasar el archivo entero por memoria: el body de
  // la respuesta se reenvia tal cual.
  const source = await impl(signedUrl);
  if (!source.ok) {
    throw new PublishError(
      `No pude leer la media del bucket (${source.status})`,
      source.status >= 500 ? "temporary" : "permanent",
    );
  }

  const uploaded = await impl(presigned.uploadUrl, {
    method: "PUT",
    body: await source.arrayBuffer(),
    headers: { "Content-Type": entry.mime_type },
  });

  if (!uploaded.ok) {
    throw new PublishError(
      `Zernio rechazo la subida de la media (${uploaded.status})`,
      uploaded.status === 429 || uploaded.status >= 500 ? "temporary" : "permanent",
    );
  }

  // Se anota DESPUES de subir: una fila que dice que el archivo esta y no
  // esta haria que la proxima publicacion use una URL que no sirve.
  const { error } = await supabase.from("provider_media").upsert(
    {
      workspace_id: workspaceId,
      publisher: ZERNIO_PUBLISHER,
      storage_path: entry.storage_path,
      size_bytes: entry.size_bytes,
      provider_url: presigned.publicUrl,
      uploaded_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,publisher,storage_path" },
  );

  if (error) {
    // No es motivo para frenar: la publicacion puede salir igual, solo que
    // la proxima vez el archivo se sube de nuevo.
    console.error("[zernio] no pude anotar la media subida:", error.message);
  }

  return presigned.publicUrl;
}
