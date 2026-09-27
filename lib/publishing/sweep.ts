/**
 * Publicaciones trabadas (A14).
 *
 * Una fila pasa a `publishing` cuando el despachador la toma. Si el proceso
 * muere despues de tomarla —se corta la corrida del cron, se cae el
 * contenedor— nadie vuelve a mirarla: no hay job pendiente, porque ya se
 * consumio, y no hay revision agendada, porque el publicador nunca contesto.
 * La fila queda diciendo "publicando" para siempre y la pieza, "programada".
 *
 * Lo mismo con una que quedo esperando la revision pero sin `ref`: no hay
 * nada que preguntarle al proveedor.
 *
 * Esto las devuelve a `failed` temporal y las vuelve a encolar. Temporal y no
 * permanente porque no se sabe si salio o no: si ya se habia publicado, el
 * publicador lo detecta al reintentar (Zernio con el id de pedido, YouTube
 * con la subida reanudable) y no duplica.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { schedulePublish } from "./dispatcher";

type Db = SupabaseClient<Database>;

/**
 * Cuanto puede tardar una publicacion antes de darla por trabada.
 *
 * Media hora es varias veces lo que tarda la subida mas lenta que hacemos
 * (un video a YouTube por trozos). Menos que eso cortaria publicaciones que
 * todavia estan en curso.
 */
export const STUCK_AFTER_MINUTES = 30;

export interface SweepResult {
  recovered: number;
}

/**
 * Devuelve a la cola las publicaciones que se quedaron colgadas.
 *
 * Nunca lanza: es un barrido de fondo dentro del cron de jobs, y que falle
 * no puede frenar el resto de la cola.
 */
export async function sweepStuckPublications(
  supabase: Db,
  now: Date = new Date(),
): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000).toISOString();

  const { data: rows, error } = await supabase
    .from("social_posts")
    .select("id, workspace_id, publisher, publisher_ref, updated_at")
    .eq("status", "publishing")
    .lt("updated_at", cutoff)
    .is("deleted_at", null)
    .limit(50);

  if (error) {
    console.error("[publishing] no pude buscar publicaciones trabadas:", error.message);
    return { recovered: 0 };
  }

  let recovered = 0;

  for (const row of rows ?? []) {
    const { error: updateError } = await supabase
      .from("social_posts")
      .update({
        status: "failed",
        last_error: "La publicacion se quedo a mitad de camino. Se vuelve a intentar.",
        last_error_kind: "temporary",
      })
      .eq("id", row.id)
      // Si algo la resolvio entre la lectura y ahora, no se pisa.
      .eq("status", "publishing");

    if (updateError) {
      console.error("[publishing] no pude destrabar la publicacion:", updateError.message);
      continue;
    }

    try {
      await schedulePublish(supabase, row.id, row.workspace_id, 0, row.publisher);
      recovered++;
    } catch (err) {
      // Queda en `failed` con el motivo: se ve en la pantalla y se puede
      // reintentar a mano. Mejor que volver a dejarla en `publishing`.
      console.error("[publishing] no pude reencolar la publicacion trabada:", err);
    }
  }

  return { recovered };
}
