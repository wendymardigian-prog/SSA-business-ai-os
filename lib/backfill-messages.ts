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
 * **Los ids, verificados contra la API real (24 de septiembre de 2026).** El
 * endpoint de historial devuelve UN solo id por mensaje, en `id`, y es el id
 * NATIVO de Meta (el `mid` largo en base64), no el ObjectId corto de Zernio que
 * el webhook guarda en `platform_message_id`. El Bloque 1 asumio lo contrario
 * y el primer dry-run en firme lo desmintio: 0 "ya estaban" con 234 mensajes
 * guardados por webhook. Si se dedupara solo por `platform_message_id`, cada
 * corrida insertaria una copia de todo lo que entro por webhook.
 *
 * Por eso la deduplicacion mira LAS DOS columnas de id (`platform_message_id`
 * y `platform_native_message_id`) y, como red de seguridad ante un id en un
 * espacio que no conocemos, tambien direccion + fecha (al milisegundo) + texto.
 * Las filas que escribe el backfill llevan el id del historial en
 * `platform_message_id` (la columna del indice unico: la segunda corrida lo
 * descarta sola) y, cuando tiene forma de id de Meta, tambien en
 * `platform_native_message_id`, que es lo que es.
 *
 * **Rate limit.** Zernio corta a partir de las ~200 conversaciones seguidas con
 * "Rate limit exceeded. Please retry after N seconds". Se espera lo que pide y
 * se reintenta, hasta 3 veces por pagina; el barrido de las otras
 * conversaciones sigue igual.
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

/** Los ids propios de Zernio son ObjectId de Mongo: 24 caracteres hexadecimales. */
export function isZernioId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

/**
 * Cuantos milisegundos pide esperar un error de rate limit, o null si el error
 * es otra cosa. Zernio responde 429 con "Please retry after N seconds".
 */
export function rateLimitWaitMs(err: unknown): number | null {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const status = isRecord(err) ? err.statusCode : undefined;
  const match = /retry after (\d+) seconds?/i.exec(message);
  if (match) return (Number(match[1]) + 1) * 1000;
  if (status === 429 || /rate limit/i.test(message)) return 30_000;
  return null;
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
    // El historial devuelve el id nativo de Meta en `id` (ver cabecera). Se
    // guarda tambien en su columna, salvo que tenga forma de id de Zernio.
    platform_native_message_id: isZernioId(mapped.platform_message_id) ? null : mapped.platform_message_id,
    status: toMessageStatus(isRecord(raw) ? raw.deliveryStatus : undefined),
    // Lo que trae el historial y no salió de la app es un saliente externo
    // (ManyChat, la app de Instagram). Los entrantes van con origin null (F2).
    origin: mapped.direction === "outbound" ? "external" : null,
    created_at: mapped.created_at,
  };
}

const MAX_RATE_LIMIT_RETRIES = 3;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Trae el historial completo de una conversacion, paginando por cursor.
 *
 * `sortOrder: "asc"` para que las paginas avancen del mas viejo al mas nuevo:
 * Instagram respeta ese orden entre paginas (Facebook y Bluesky no, pero no son
 * de esta etapa). Nunca lanza: una conversacion que falla no puede cortar el
 * barrido de las otras 582.
 *
 * Ante un rate limit espera lo que pide la API y reintenta la misma pagina,
 * hasta MAX_RATE_LIMIT_RETRIES veces. `sleep` se inyecta para los tests.
 */
export async function fetchConversationHistory(
  zernio: Zernio,
  {
    lateConversationId,
    accountId,
    maxPages = MAX_PAGES,
    sleep = defaultSleep,
  }: {
    lateConversationId: string;
    accountId: string;
    maxPages?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ messages: unknown[]; error: string | null }> {
  const all: unknown[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    let res;
    let retries = 0;
    for (;;) {
      try {
        res = await zernio.messages.getInboxConversationMessages({
          path: { conversationId: lateConversationId },
          query: { accountId, limit: PAGE_SIZE, sortOrder: "asc", ...(cursor ? { cursor } : {}) },
        });
        break;
      } catch (err) {
        const wait = rateLimitWaitMs(err);
        if (wait !== null && retries < MAX_RATE_LIMIT_RETRIES) {
          retries++;
          await sleep(wait);
          continue;
        }
        return { messages: all, error: err instanceof Error ? err.message : "error de red" };
      }
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
 * Primero se pregunta que hay guardado y se filtra en memoria, en vez de tirar
 * los mensajes contra el indice unico y contar los rebotes: son ~580
 * conversaciones y la mayoria de las corridas no tienen nada nuevo que traer.
 * El indice sigue siendo la red de seguridad —si dos corridas se pisan, el
 * insert en lote cae a uno por uno y los duplicados se cuentan como skipped—,
 * pero no es el camino normal.
 *
 * Un mensaje del historial "ya esta" si su id coincide con cualquiera de las
 * dos columnas de id, o si ya hay una fila con la misma direccion, la misma
 * fecha al milisegundo y el mismo texto (ver la cabecera del archivo).
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
  sleep,
}: {
  supabase: Db;
  zernio: Zernio;
  conversationId: string;
  lateConversationId: string;
  accountId: string;
  workspaceId: string;
  apply: boolean;
  maxPages?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<BackfillStats & { error: string | null }> {
  const stats = emptyStats();

  const { messages, error } = await fetchConversationHistory(zernio, {
    lateConversationId,
    accountId,
    maxPages,
    sleep,
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
    .select("platform_message_id, platform_native_message_id, direction, created_at, text")
    .eq("conversation_id", conversationId);

  if (readError) {
    return { ...stats, error: `no pude leer lo ya guardado: ${readError.message}` };
  }

  const nuevos = rows.filter((r) => !isAlreadyStored(r, existing ?? []));
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

export interface StoredMessageKey {
  platform_message_id: string | null;
  platform_native_message_id?: string | null;
  direction?: string | null;
  created_at?: string | null;
  text?: string | null;
}

const sameInstant = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && new Date(a as string).getTime() === new Date(b as string).getTime();

/**
 * Si una fila del historial ya esta guardada. Pura, exportada para probarla.
 * Mira las dos columnas de id y, como red de seguridad, direccion + fecha +
 * texto: los formatos de fecha difieren entre la API ("...Z") y Postgres
 * ("...+00:00"), por eso se comparan como instantes y no como texto.
 */
export function isAlreadyStored(row: MessageInsert, existing: StoredMessageKey[]): boolean {
  const id = row.platform_message_id;
  return existing.some((e) => {
    if (id && (e.platform_message_id === id || e.platform_native_message_id === id)) return true;
    return (
      e.direction === row.direction &&
      sameInstant(e.created_at, row.created_at) &&
      (e.text ?? null) === (row.text ?? null)
    );
  });
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
