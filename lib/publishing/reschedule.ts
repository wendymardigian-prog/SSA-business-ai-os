/**
 * Mover una publicacion ya programada a otra hora (A5).
 *
 * La fila y el job tienen que moverse juntos: si se cambia la fila y queda
 * el job viejo, la publicacion sale a la hora vieja; si se cambia el job y
 * no la fila, la pantalla muestra una hora que no es.
 *
 * Con la programacion del lado del proveedor (grupo D) las redes de Zernio
 * no tienen job y se mueven con `updatePost`: por eso el cambio de hora pasa
 * por aca y no por el llamador.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import { CONTENT_PUBLISH_JOB } from "@/lib/content/jobs";

type Db = SupabaseClient<Database>;

/** Devuelve si se pudo mover. El llamador decide que decirle a la persona. */
export async function reschedulePublication(
  supabase: Db,
  params: { socialPostId: string; workspaceId: string; at: string },
): Promise<boolean> {
  const { error } = await supabase
    .from("social_posts")
    .update({ scheduled_at: params.at, status: "scheduled", last_error: null, last_error_kind: null })
    .eq("id", params.socialPostId)
    // Solo se mueve lo que todavia esta en la cola: una publicacion que ya
    // salio o que esta saliendo no se reprograma por cambiar un campo.
    .eq("status", "scheduled");

  if (error) {
    console.error("[publishing] no pude mover la publicacion:", error.message);
    return false;
  }

  await supabase
    .from("scheduled_jobs")
    .delete()
    .eq("type", CONTENT_PUBLISH_JOB)
    .eq("status", "pending")
    .contains("payload", { socialPostId: params.socialPostId });

  try {
    await scheduleJob(
      supabase,
      CONTENT_PUBLISH_JOB,
      { socialPostId: params.socialPostId, workspaceId: params.workspaceId },
      new Date(params.at),
    );
  } catch (err) {
    console.error("[publishing] no pude agendar la hora nueva:", err);
    // Sin job la fila mentiria: se marca para que se vea.
    await supabase
      .from("social_posts")
      .update({
        status: "failed",
        last_error: "No pude mover la publicacion. Programala de nuevo.",
        last_error_kind: "temporary",
      })
      .eq("id", params.socialPostId);
    return false;
  }

  return true;
}
