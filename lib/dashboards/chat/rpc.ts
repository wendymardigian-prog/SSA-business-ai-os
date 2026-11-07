/**
 * El unico camino del dashboard de Chat hacia la base.
 *
 * Cada consulta pasa por la cola (`query-limiter.ts`), se reintenta una vez si la
 * base la corto por tiempo, y lo que llega a la pantalla es un texto en castellano:
 * el mensaje crudo de la base se queda en el log del servidor.
 *
 * `lib/dashboards/chat/rpc-boundary.test.ts` falla si aparece un `.rpc(` afuera.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { chatQueryLimiter, QueueDeadlineError, type QueryLimiter } from "./query-limiter";

type Db = SupabaseClient<Database>;
type Functions = Database["public"]["Functions"];

/** El corte de Postgres por `statement_timeout`. */
const STATEMENT_TIMEOUT_CODE = "57014";

export const CHAT_QUERY_RETRY_DELAY_MS = 1_500;

export const TIMEOUT_MESSAGE = "La base de datos tardó demasiado en responder. Probá de nuevo en unos segundos.";
export const BUSY_MESSAGE = "Hay muchas consultas en espera. Probá de nuevo en unos segundos.";
export const GENERIC_MESSAGE = "La base de datos no pudo responder. Probá de nuevo en unos segundos.";

export interface ChatQueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

export interface ChatQueryDeps {
  limiter?: QueryLimiter;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function failure(message: string, code?: string): ChatQueryResult {
  return { data: null, error: { message, code } };
}

/**
 * Corre una consulta por la cola. Nunca lanza.
 *
 * La espera del reintento va AFUERA de la cola: si no, ocuparia un lugar sin hacer
 * nada, justo cuando la base esta pidiendo aire.
 */
export async function chatQuery(
  label: string,
  run: () => PromiseLike<ChatQueryResult>,
  deps: ChatQueryDeps = {},
): Promise<ChatQueryResult> {
  const limiter = deps.limiter ?? chatQueryLimiter();
  const sleep = deps.sleep ?? defaultSleep;

  try {
    let result = await limiter.run(run);
    if (result.error?.code === STATEMENT_TIMEOUT_CODE) {
      console.error(`[dashboard-chat] ${label}: corte por tiempo, reintento`);
      await sleep(CHAT_QUERY_RETRY_DELAY_MS);
      result = await limiter.run(run);
    }
    if (!result.error) return result;

    console.error(`[dashboard-chat] ${label}:`, result.error.code ?? "", result.error.message);
    return failure(result.error.code === STATEMENT_TIMEOUT_CODE ? TIMEOUT_MESSAGE : GENERIC_MESSAGE, result.error.code);
  } catch (err) {
    if (err instanceof QueueDeadlineError) return failure(BUSY_MESSAGE);
    console.error(`[dashboard-chat] ${label}:`, err instanceof Error ? err.message : "error inesperado");
    return failure(GENERIC_MESSAGE);
  }
}

/** Una funcion SQL, por la cola. Los argumentos siguen tipados contra `database.ts`. */
export function chatRpc<F extends keyof Functions & string>(
  client: Db,
  fn: F,
  args: Functions[F]["Args"],
  deps?: ChatQueryDeps,
): Promise<ChatQueryResult> {
  return chatQuery(fn, () => client.rpc(fn as never, args as never) as unknown as PromiseLike<ChatQueryResult>, deps);
}
