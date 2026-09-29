/**
 * Borrar de verdad la media vencida del chat (F5).
 *
 * Corre dentro del cron `content-media-cleanup`, que ya es diario y ya borra de
 * Storage. No se crea una ruta de cron nueva a proposito: eso obligaria a tocar
 * la allowlist de `private.call_app_cron` y a agendar otro job, para hacer lo
 * mismo en el mismo momento del dia.
 *
 * (La purga de filas borradas, `purge_soft_deleted`, no servia: es SQL puro y
 * desde SQL no se puede borrar de Storage.)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CHAT_MEDIA_BUCKET } from "./bucket";
import { planChatMediaCleanup, type MessageToClean } from "./cleanup";

type Db = SupabaseClient<Database>;

/** Cuantos mensajes se revisan por workspace y por corrida. */
const BATCH = 200;

export async function cleanupChatMedia(
  supabase: Db,
  now: Date = new Date(),
): Promise<{ cleanedMessages: number; deletedFiles: number }> {
  let cleanedMessages = 0;
  let deletedFiles = 0;

  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("id, chat_media_retention_days");

  if (error) {
    console.error("[chat-media-cleanup] no pude leer los workspaces:", error.message);
    return { cleanedMessages, deletedFiles };
  }

  for (const workspace of workspaces ?? []) {
    const retentionDays = workspace.chat_media_retention_days ?? 180;
    if (retentionDays <= 0) continue;

    const cutoff = new Date(now.getTime() - retentionDays * 24 * 3_600_000).toISOString();

    // Solo los mensajes con adjuntos en la forma nueva: los viejos no tienen
    // ningun archivo nuestro que borrar.
    const { data: messages, error: readError } = await supabase
      .from("messages")
      .select("id, created_at, attachments")
      .eq("workspace_id", workspace.id)
      .not("attachments", "is", null)
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(BATCH);

    if (readError) {
      console.error("[chat-media-cleanup] no pude leer los mensajes:", readError.message);
      continue;
    }

    const plans = planChatMediaCleanup({
      messages: (messages ?? []) as unknown as MessageToClean[],
      retentionDays,
      now,
    });

    for (const plan of plans) {
      const { error: storageError } = await supabase.storage.from(CHAT_MEDIA_BUCKET).remove(plan.paths);

      if (storageError) {
        // Si no se pudo borrar, NO se marca la fila: al dia siguiente se vuelve
        // a intentar. Marcarla dejaria el archivo en el bucket para siempre y
        // sin nadie que lo busque.
        console.error(`[chat-media-cleanup] ${plan.messageId}:`, storageError.message);
        continue;
      }

      // La transcripcion no se toca: solo los adjuntos.
      const { error: updateError } = await supabase
        .from("messages")
        .update({ attachments: plan.attachments as never })
        .eq("id", plan.messageId);

      if (updateError) {
        console.error(`[chat-media-cleanup] ${plan.messageId}:`, updateError.message);
        continue;
      }

      cleanedMessages++;
      deletedFiles += plan.paths.length;
    }
  }

  return { cleanedMessages, deletedFiles };
}
