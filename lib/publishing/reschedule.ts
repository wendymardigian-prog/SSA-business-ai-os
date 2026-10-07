/**
 * Mover una publicacion ya programada a otra hora (A5).
 *
 * La fila y el job tienen que moverse juntos: si se cambia la fila y queda
 * el job viejo, la publicacion sale a la hora vieja; si se cambia el job y
 * no la fila, la pantalla muestra una hora que no es.
 *
 * Con la programacion del lado del proveedor (grupo D) las redes de Zernio
 * no tienen job de publicar: el post vive agendado ALLA. Moverlas es pedirle
 * a Zernio que cambie la fecha de SU post (`updatePost`, que hace
 * `runProviderSchedule` cuando la fila ya tiene `publisher_ref`). Encolar un
 * "publicar ahora" a la hora nueva, como con las demas, la publicaba dos
 * veces: una a la hora vieja (Zernio) y otra a la nueva (Contenido v4).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import {
  CONTENT_PROVIDER_SCHEDULE_JOB,
  CONTENT_PUBLISH_JOB,
  CONTENT_UPLOAD_JOB,
  jobTypeForPublisher,
} from "@/lib/content/jobs";
import { schedulesOnProvider } from "./provider-scheduling";

type Db = SupabaseClient<Database>;

/** Devuelve si se pudo mover. El llamador decide que decirle a la persona. */
export async function reschedulePublication(
  supabase: Db,
  params: { socialPostId: string; workspaceId: string; at: string },
): Promise<boolean> {
  const { data: row } = await supabase
    .from("social_posts")
    .select("publisher")
    .eq("id", params.socialPostId)
    .maybeSingle();

  const onProvider = schedulesOnProvider(row?.publisher);

  const { error } = await supabase
    .from("social_posts")
    .update({
      scheduled_at: params.at,
      // En Zernio vuelve a `uploading` hasta que confirme la hora nueva: decir
      // "programado" antes seria prometer una hora que todavia no tiene.
      status: onProvider ? "uploading" : "scheduled",
      last_error: null,
      last_error_kind: null,
    })
    .eq("id", params.socialPostId)
    // Solo se mueve lo que todavia esta en la cola: una publicacion que ya
    // salio o que esta saliendo no se reprograma por cambiar un campo.
    .eq("status", "scheduled");

  if (error) {
    console.error("[publishing] no pude mover la publicacion:", error.message);
    return false;
  }

  for (const type of [CONTENT_PUBLISH_JOB, CONTENT_UPLOAD_JOB, CONTENT_PROVIDER_SCHEDULE_JOB]) {
    await supabase
      .from("scheduled_jobs")
      .delete()
      .eq("type", type)
      .eq("status", "pending")
      .contains("payload", { socialPostId: params.socialPostId });
  }

  try {
    await scheduleJob(
      supabase,
      // Zernio: el job corre YA y le cambia la fecha a su post. Las demas: el
      // job es el que publica, a la hora nueva.
      onProvider ? CONTENT_PROVIDER_SCHEDULE_JOB : jobTypeForPublisher(row?.publisher),
      { socialPostId: params.socialPostId, workspaceId: params.workspaceId },
      onProvider ? new Date() : new Date(params.at),
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
