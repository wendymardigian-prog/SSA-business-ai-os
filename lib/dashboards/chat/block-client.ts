/**
 * Pedirle un bloque al servidor desde el navegador.
 *
 * Nunca lanza, salvo que el pedido se haya cancelado: quien cancela (un cambio de
 * filtro) ya no quiere la respuesta, y lo mira con su propia señal.
 *
 * Puro: `fetch` se puede simular en el test.
 */

import type { ChatBlockData, ChatBlockKey } from "./block-keys";
import type { BlockResult } from "./types";

export const CHAT_BLOCK_ROUTE = "/api/v1/dashboards/chat/block";

const NETWORK_MESSAGE = "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.";
const SESSION_MESSAGE = "Tu sesión venció. Volvé a entrar para ver estos datos.";
const FORBIDDEN_MESSAGE = "No tenés permiso para ver estos datos.";
const GENERIC_MESSAGE = "No pudimos traer los datos. Probá de nuevo en unos segundos.";

/** La direccion del bloque: los filtros como los tiene la URL, sin confiar en ellos (la ruta los valida). */
export function chatBlockUrl(block: ChatBlockKey, query: string, fresh: boolean): string {
  const params = new URLSearchParams(query);
  params.set("block", block);
  if (fresh) params.set("fresh", "1");
  return `${CHAT_BLOCK_ROUTE}?${params.toString()}`;
}

export async function fetchChatBlock<K extends ChatBlockKey>(
  block: K,
  query: string,
  options: { fresh?: boolean; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<BlockResult<ChatBlockData[K]>> {
  const doFetch = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(chatBlockUrl(block, query, options.fresh ?? false), {
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, error: NETWORK_MESSAGE };
  }

  if (res.status === 401) return { ok: false, error: SESSION_MESSAGE };
  if (res.status === 403) return { ok: false, error: FORBIDDEN_MESSAGE };
  if (!res.ok) return { ok: false, error: GENERIC_MESSAGE };

  try {
    const body = (await res.json()) as BlockResult<ChatBlockData[K]>;
    if (typeof body?.ok !== "boolean") return { ok: false, error: GENERIC_MESSAGE };
    return body;
  } catch {
    return { ok: false, error: GENERIC_MESSAGE };
  }
}
