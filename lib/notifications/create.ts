/**
 * Crear notificaciones (F18).
 *
 * Una regla manda sobre todo lo demas: **nunca lanza**. Un aviso que falla no
 * puede tumbar la operacion que lo genero. Que no se entere nadie de que se
 * derivo una conversacion es malo; que la conversacion no se derive porque el
 * aviso fallo es peor.
 *
 * Las escribe siempre el service role: la tabla no tiene policy de INSERT a
 * proposito, para que un usuario no pueda fabricarle un aviso a otro.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { NotificationType, NotificationEntity } from "./types";

type Db = SupabaseClient<Database>;

export interface CreateNotificationArgs {
  supabase: Db;
  workspaceId: string;
  type: NotificationType;
  /** Titulo corto, en lenguaje de la usuaria. */
  title: string;
  /** Que paso y que hacer al respecto. */
  body?: string;
  entityType?: NotificationEntity;
  entityId?: string | null;
  /**
   * A quien va dirigida. Omitido = a los Owner/Admin del workspace.
   * NO significa "a cualquiera": la RLS lo resuelve por rol.
   */
  recipientId?: string | null;
  /** Datos del evento. Nunca API keys, contenido de mensajes ni PII de mas. */
  metadata?: Record<string, unknown>;
}

/** Crea la notificacion. Devuelve si se pudo, sin lanzar nunca. */
export async function createNotification(args: CreateNotificationArgs): Promise<boolean> {
  const { supabase, workspaceId, type, title, body, entityType, entityId, recipientId, metadata } =
    args;

  try {
    const { error } = await supabase.from("notifications").insert({
      workspace_id: workspaceId,
      type,
      title,
      body: body ?? null,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      recipient_id: recipientId ?? null,
      metadata: (metadata ?? {}) as Json,
    });

    if (error) {
      console.error(`[aviso:${type}] no pude registrar el aviso:`, error.message);
      return false;
    }

    return true;
  } catch (err) {
    // Un fallo de red o un cliente mal armado tampoco pueden propagarse.
    console.error(
      `[aviso:${type}] no pude registrar el aviso:`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Evita repetir el mismo aviso una y otra vez.
 *
 * Un flow que deriva la misma conversacion cinco veces en una hora, o un canal
 * que rebota, generarian cinco avisos identicos y la campana dejaria de
 * servir. Si ya hay uno SIN LEER del mismo tipo y la misma entidad dentro de la
 * ventana, no se crea otro.
 *
 * Solo mira los no leidos a proposito: si la usuaria ya lo leyo y el problema
 * vuelve a pasar, eso SI es noticia nueva.
 */
export async function createNotificationOnce(
  args: CreateNotificationArgs & { withinMinutes?: number },
): Promise<boolean> {
  const { supabase, workspaceId, type, entityId, withinMinutes = 60 } = args;

  try {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();

    let query = supabase
      .from("notifications")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("type", type)
      .is("read_at", null)
      .gte("created_at", since)
      .limit(1);

    query = entityId ? query.eq("entity_id", entityId) : query.is("entity_id", null);

    const { data, error } = await query;

    // Si no se puede chequear, se crea igual: un aviso repetido molesta menos
    // que un aviso que falta.
    if (!error && data && data.length > 0) return false;
  } catch (err) {
    console.error(
      `[aviso:${type}] no pude revisar si ya existia:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return createNotification(args);
}
