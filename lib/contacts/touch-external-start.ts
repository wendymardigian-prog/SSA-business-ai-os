/**
 * El toque de un chat que empezó el negocio FUERA del sistema (ManyChat o la app de Instagram).
 *
 * Desde la importación de conversaciones (00267), el eco `message.sent` de ese primer mensaje y el aviso
 * `conversation.started` crean el contacto (`ensureZernioConversation`). Sin este toque, ese contacto quedaba sin
 * ningún origen: la persona todavía no escribió, y cuando escribe ya "existía". El origen es ese chat: Instagram,
 * `origin = 'dm'`, `medium = 'dm_external'` (orgánico por `touchChannel`).
 *
 * Solo para un contacto NUEVO (quien llama lo decide): uno que ya existía conserva su historia.
 *
 * De paso encola el vínculo retroactivo de comentarios del contacto (`comment_backfill`): ManyChat suele escribir
 * porque la persona comentó, y el eco no trae su @, así que el trigger de la 00234 no lo encola. El job busca también
 * por el id de Instagram (`platform_sender_id`).
 *
 * NUNCA lanza: el eco ya se guardó, o está por guardarse.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { TouchAccount } from "@/lib/inbox/accounts";
import { scheduleJob } from "@/lib/scheduler";
import { COMMENT_BACKFILL_JOB } from "@/lib/jobs/handlers/comment-backfill";
import { recordTouch, type TouchInput } from "./touch";

type Db = SupabaseClient<Database>;

/** La clave del toque: una por conversación de Zernio, así un eco repetido o el backfill no lo duplican. */
export const externalStartDedupeKey = (lateConversationId: string) => `external-start:${lateConversationId}`;

export interface ExternalStartTouchParams {
  workspaceId: string;
  contactId: string;
  /** La plataforma del canal (instagram, facebook...). */
  platform: string;
  lateConversationId: string;
  /** Cuándo empezó: la fecha del mensaje del negocio, o la del aviso de conversación nueva. */
  occurredAt: string | Date;
  /** El id de Zernio del mensaje del negocio, si lo hay. */
  messageId?: string | null;
  account?: TouchAccount | null;
}

/** El toque, armado. Puro: lo comparten el receptor y el backfill. */
export function externalStartTouch(params: ExternalStartTouchParams): TouchInput {
  return {
    occurredAt: params.occurredAt,
    source: params.platform,
    medium: "dm_external",
    origin: "dm",
    dedupeKey: externalStartDedupeKey(params.lateConversationId),
    raw: {
      via: "external_outbound",
      message_id: params.messageId ?? undefined,
      account_id: params.account?.id,
      account_label: params.account?.label,
    },
  };
}

export async function recordExternalStartTouch(supabase: Db, params: ExternalStartTouchParams): Promise<void> {
  try {
    await recordTouch(supabase, {
      workspaceId: params.workspaceId,
      contactId: params.contactId,
      touch: externalStartTouch(params),
    });
  } catch (err) {
    console.error("[atribucion] fallo el toque del chat externo:", err instanceof Error ? err.message : String(err));
  }

  try {
    await scheduleJob(
      supabase,
      COMMENT_BACKFILL_JOB,
      { workspace_id: params.workspaceId, contact_id: params.contactId },
      new Date(Date.now() + 5_000),
      `comment_backfill:${params.contactId}:external-start`,
    );
  } catch (err) {
    // 23505: ya hay uno esperando para este contacto.
    if ((err as { code?: string } | null)?.code !== "23505") {
      console.error("[atribucion] no pude encolar el vinculo de comentarios:", err instanceof Error ? err.message : String(err));
    }
  }
}
