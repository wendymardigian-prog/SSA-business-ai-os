/**
 * Lo que llega del proveedor cuando una publicacion termina (F35).
 *
 * Zernio y Postproxy contestan "recibido" y avisan despues. Ese aviso es el
 * camino rapido; el job de revision es la red de seguridad. Los dos terminan
 * aca, en la misma funcion, para que la fila quede igual venga por donde
 * venga.
 *
 * Lo que interpreta el payload es puro y esta arriba: son formatos ajenos que
 * cambian, y probarlos contra la base seria probar el mock.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { rowFromResult, completePostIfDone } from "./dispatcher";
import type { PublishResult } from "./types";

type Db = SupabaseClient<Database>;

export interface InboundPublishEvent {
  /** La referencia que dio el proveedor al aceptar la publicacion. */
  ref: string;
  platform: string;
  result: PublishResult;
}

/**
 * Un evento `post.platform.*` de Zernio.
 *
 * Verificado contra el SDK instalado: trae el estado terminal de UNA red,
 * con el id y el link cuando salio, y el error cuando no. Se usa ese y no
 * `post.published`, que es del post entero: nuestras filas son por red.
 */
export function fromZernioPlatformEvent(payload: unknown): InboundPublishEvent | null {
  const event = payload as {
    event?: string;
    post?: { id?: string };
    platform?: { name?: string; status?: string; platformPostId?: string; publishedUrl?: string; error?: string };
  };

  const ref = event?.post?.id;
  const platform = event?.platform?.name;
  if (!ref || !platform) return null;

  if (event.event === "post.platform.published") {
    return {
      ref,
      platform,
      result: {
        status: "published",
        externalId: event.platform?.platformPostId ?? null,
        externalUrl: event.platform?.publishedUrl ?? null,
        ref,
      },
    };
  }

  if (event.event === "post.platform.failed") {
    return {
      ref,
      platform,
      result: {
        status: "failed",
        // La red ya lo rechazo: reintentar lo mismo da lo mismo.
        error: event.platform?.error || "La red rechazo la publicacion",
        errorKind: "permanent",
      },
    };
  }

  // `deleted` y `tiktok.url_resolved` no cambian el resultado de publicar.
  return null;
}

/** Un aviso de Postproxy. Ver el comentario del receptor sobre su formato. */
export function fromPostproxyEvent(payload: unknown): InboundPublishEvent | null {
  const event = payload as {
    id?: string;
    post_id?: string;
    status?: string;
    platform?: string;
    error?: string;
    url?: string;
    external_id?: string;
  };

  const ref = event?.post_id ?? event?.id;
  if (!ref) return null;
  const platform = event.platform ?? "youtube";

  if (event.status === "published" || event.status === "posted") {
    return {
      ref,
      platform,
      result: {
        status: "published",
        externalId: event.external_id ?? null,
        externalUrl: event.url ?? null,
        ref,
      },
    };
  }

  if (event.status === "failed" || event.status === "error") {
    return {
      ref,
      platform,
      result: { status: "failed", error: event.error || "Postproxy no pudo publicar", errorKind: "permanent" },
    };
  }

  return null;
}

/**
 * Aplica el aviso a la fila que estaba esperando.
 *
 * Solo toca filas en "publicando": si la revision ya la resolvio, el aviso
 * llega tarde y no tiene nada que corregir. Devuelve si cambio algo, para que
 * el receptor pueda contestar sin mentir.
 */
export async function settlePublication(supabase: Db, event: InboundPublishEvent): Promise<boolean> {
  const { data: row } = await supabase
    .from("social_posts")
    .select("id, content_post_id, status")
    .eq("publisher_ref", event.ref)
    .eq("platform", event.platform as Database["public"]["Tables"]["social_posts"]["Row"]["platform"])
    .is("deleted_at", null)
    .maybeSingle();

  if (!row || row.status !== "publishing") return false;

  const { error } = await supabase
    .from("social_posts")
    .update(rowFromResult(event.result, new Date()))
    .eq("id", row.id)
    // La misma guarda que al publicar: si otra cosa la resolvio en el medio,
    // este update no pisa nada.
    .eq("status", "publishing");

  if (error) {
    console.error("[publishing] no pude aplicar el aviso:", error.message);
    return false;
  }

  if (event.result.status === "published") {
    await completePostIfDone(supabase, row.content_post_id);
  }
  return true;
}
