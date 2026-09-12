/**
 * Backfill de mensajes historicos desde Zernio (F20).
 *
 * Hasta la Fase 3 los mensajes de Instagram no se guardaban localmente, asi que
 * el dia que se prende el guardado la tabla arranca desde cero y el agente y
 * los dashboards no tienen nada de que hablar. Esto trae lo que la API todavia
 * tenga, una sola vez.
 *
 * **Cuanta historia hay, de verdad.** El SDK de Zernio lo dice sin vueltas:
 * Meta replica las 500 conversaciones mas recientes por cuenta y, de cada una,
 * los 500 mensajes mas recientes. Lo anterior no existe para nadie: ni para
 * nosotros ni para Zernio. Asi que "traer la historia" tiene un techo duro y no
 * hay parametro que lo mueva.
 *
 * **Conviene correrlo dos veces, con dias de diferencia.** El replay de Meta
 * corre en segundo plano y puede terminar despues de un barrido; el propio SDK
 * recomienda no confiar en una sola pasada. Correrlo de nuevo es gratis: el
 * indice unico (conversation_id, platform_message_id) descarta todo lo que ya
 * este, asi que la segunda corrida solo suma lo que aparecio en el medio.
 *
 * **Por que el id de Zernio y no el de Instagram.** Este endpoint devuelve
 * unicamente su propio `id`; el nativo de la plataforma no viene. Por suerte es
 * el mismo que guarda recordSend al enviar y el mismo que usa la bandeja al
 * leer, asi que los salientes que ya estaban guardados se reconocen solos y no
 * se duplican. Si el receptor de webhooks guardara el id nativo, este backfill
 * insertaria una copia de cada mensaje: es la razon por la que toda la Fase 3
 * usa un solo espacio de ids.
 *
 * No se guarda ningun archivo: de la media queda el link que viene en
 * `attachments`, igual que en el camino en vivo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { Zernio } from "@/lib/zernio-client";
// Relativo y no "@/": este modulo lo importa tambien scripts/backfill-zernio-messages.mjs,
// que corre con el type-stripping de Node y no sabe resolver el alias. Los
// imports de tipos de arriba se borran al ejecutar, asi que esos pueden quedar.
import { toInboxMessage } from "./zernio-message.ts";

type Db = SupabaseClient<Database>;
type MessageInsert = Database["public"]["Tables"]["messages"]["Insert"];
type MessageStatus = Database["public"]["Tables"]["messages"]["Row"]["status"];

/** El maximo que acepta la API. Pedir mas no trae mas. */
export const PAGE_SIZE = 100;

/**
 * 500 mensajes por conversacion es lo que Meta replica; cinco paginas llegan
 * justo. Se deja como tope explicito para que un `hasMore` que nunca se apaga
 * no deje el script dando vueltas.
 */
export const MAX_PAGES = 5;

/**
 * Zernio informa estados que nuestra tabla no tiene (`read`, `deleted`), y el
 * CHECK de la columna los rechaza. Se mapea a lo mas cercano en vez de dejar
 * que el insert explote a mitad de un lote.
 */
export function toMessageStatus(raw: unknown): MessageStatus {
  switch (raw) {
    case "pending":
    case "sent":
    case "delivered":
    case "failed":
      return raw;
    case "read":
      // Leido es entregado y algo mas; la tabla no distingue.
      return "delivered";
    default:
      return "sent";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Traduce un mensaje de Zernio a una fila de `messages`.
 *
 * Devuelve null cuando la fila no corresponde guardarla:
 *
 * - **El remitente lo borro** (`isDeleted`). Zernio conserva el texto original
 *   aunque la persona lo haya dado de baja, pero guardarnos algo que el lead
 *   borro va en contra de las reglas de Meta sobre borrados, que es justo lo
 *   que la politica de datos de esta fase se compromete a honrar. Si se borro
 *   despues de que el webhook ya lo guardo, la purga por retencion se ocupa; lo
 *   que no vamos a hacer es traerlo a proposito.
 * - **No tiene id**, porque sin el no hay forma de deduplicarlo y cada corrida
 *   del backfill sumaria otra copia.
 *
 * El resto del mapeo lo hace toInboxMessage, que ya sabe las tres trampas de
 * esta API: el texto viene en `message`, en las plantillas viene vacio y hay
 * que sacarlo del attachment, y la direccion se dice `incoming`/`outgoing`.
 */
export function toMessageRow(
  raw: unknown,
  conversationId: string,
  workspaceId: string,
): MessageInsert | null {
  if (isRecord(raw) && raw.isDeleted === true) return null;

  const mapped = toInboxMessage(raw, conversationId);
  if (!mapped.platform_message_id) return null;

  return {
    conversation_id: conversationId,
    workspace_id: workspaceId,
    direction: mapped.direction,
    text: mapped.text,
    attachments: mapped.attachments as MessageInsert["attachments"],
    platform_message_id: mapped.platform_message_id,
    status: toMessageStatus(isRecord(raw) ? raw.deliveryStatus : undefined),
    created_at: mapped.created_at,
  };
}

/**
 * Trae el historial completo de una conversacion, paginando por cursor.
 *
 * `sortOrder: "asc"` para que las paginas avancen del mas viejo al mas nuevo:
 * Instagram respeta ese orden entre paginas (Facebook y Bluesky no, pero no son
 * de esta etapa). Nunca lanza: una conversacion que falla no puede cortar el
 * barrido de las otras 452.
 */
export async function fetchConversationHistory(
  zernio: Zernio,
  {
    lateConversationId,
    accountId,
    maxPages = MAX_PAGES,
  }: { lateConversationId: string; accountId: string; maxPages?: number },
): Promise<{ messages: unknown[]; error: string | null }> {
  const all: unknown[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    let res;
    try {
      res = await zernio.messages.getInboxConversationMessages({
        path: { conversationId: lateConversationId },
        query: { accountId, limit: PAGE_SIZE, sortOrder: "asc", ...(cursor ? { cursor } : {}) },
      });
    } catch (err) {
      return { messages: all, error: err instanceof Error ? err.message : "error de red" };
    }

    // La respuesta viene doble envuelta y no siempre igual, como ya documenta
    // toInboxThread.
    const body = (res?.data ?? {}) as {
      messages?: unknown[];
      data?: unknown[];
      pagination?: { hasMore?: boolean; nextCursor?: string | null };
    };
    const batch = body.messages ?? body.data ?? [];
    all.push(...batch);

    const next = body.pagination;
    if (!next?.hasMore || !next.nextCursor) break;
    cursor = next.nextCursor;
  }

  return { messages: all, error: null };
}

export interface BackfillStats {
  /** Mensajes que devolvio la API. */
  fetched: number;
  /** Filas nuevas escritas. */
  inserted: number;
  /** Ya estaban guardadas (el eco de los salientes, o una corrida anterior). */
  skipped: number;
  /** Se descartaron a proposito: borrados por el remitente o sin id. */
  discarded: number;
  /** No se pudieron escribir. */
  failed: number;
}

export const emptyStats = (): BackfillStats => ({
  fetched: 0,
  inserted: 0,
  skipped: 0,
  discarded: 0,
  failed: 0,
});

/**
 * Backfill de UNA conversacion.
 *
 * Primero se pregunta que ids ya estan guardados y se filtra en memoria, en vez
 * de tirar los mensajes contra el indice unico y contar los rebotes: son ~450
 * conversaciones y la mayoria de las corridas no tienen nada nuevo que traer.
 * El indice sigue siendo la red de seguridad —si dos corridas se pisan, el
 * insert en lote cae a uno por uno y los duplicados se cuentan como skipped—,
 * pero no es el camino normal.
 *
 * Con `apply: false` no escribe nada: cuenta lo que escribiria.
 */
export async function backfillConversation({
  supabase,
  zernio,
  conversationId,
  lateConversationId,
  accountId,
  workspaceId,
  apply,
  maxPages = MAX_PAGES,
}: {
  supabase: Db;
  zernio: Zernio;
  conversationId: string;
  lateConversationId: string;
  accountId: string;
  workspaceId: string;
  apply: boolean;
  maxPages?: number;
}): Promise<BackfillStats & { error: string | null }> {
  const stats = emptyStats();

  const { messages, error } = await fetchConversationHistory(zernio, {
    lateConversationId,
    accountId,
    maxPages,
  });
  stats.fetched = messages.length;
  if (messages.length === 0) return { ...stats, error };

  const rows: MessageInsert[] = [];
  for (const raw of messages) {
    const row = toMessageRow(raw, conversationId, workspaceId);
    if (row) rows.push(row);
    else stats.discarded++;
  }
  if (rows.length === 0) return { ...stats, error };

  const { data: existing, error: readError } = await supabase
    .from("messages")
    .select("platform_message_id")
    .eq("conversation_id", conversationId)
    .not("platform_message_id", "is", null);

  if (readError) {
    return { ...stats, error: `no pude leer lo ya guardado: ${readError.message}` };
  }

  const known = new Set((existing ?? []).map((m) => m.platform_message_id));
  const nuevos = rows.filter((r) => !known.has(r.platform_message_id ?? null));
  stats.skipped = rows.length - nuevos.length;

  if (nuevos.length === 0) return { ...stats, error };
  if (!apply) {
    stats.inserted = nuevos.length; // lo que escribiria
    return { ...stats, error };
  }

  const { error: insertError } = await supabase.from("messages").insert(nuevos);
  if (!insertError) {
    stats.inserted = nuevos.length;
    return { ...stats, error };
  }

  // Un lote entero se cae por una sola fila. Se reintenta de a uno para no
  // perder las otras 99 por un duplicado que entro en el medio.
  for (const row of nuevos) {
    const { error: rowError } = await supabase.from("messages").insert(row);
    if (!rowError) stats.inserted++;
    else if (rowError.code === "23505") stats.skipped++;
    else stats.failed++;
  }

  return { ...stats, error };
}

/** Suma en el acumulador, para ir juntando el total del barrido. */
export function addStats(total: BackfillStats, one: BackfillStats): BackfillStats {
  return {
    fetched: total.fetched + one.fetched,
    inserted: total.inserted + one.inserted,
    skipped: total.skipped + one.skipped,
    discarded: total.discarded + one.discarded,
    failed: total.failed + one.failed,
  };
}
