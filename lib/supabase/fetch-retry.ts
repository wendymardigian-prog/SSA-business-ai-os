/**
 * Reintento de los pedidos a Supabase que se cortan por la red.
 *
 * Por que existe: el 26/11/2026 a las 17:40 UTC la app en Railway reutilizo una conexion que Supabase ya habia cerrado
 * ("New streams cannot be created after receiving a GOAWAY", ERR_HTTP2_GOAWAY_SESSION). Cada pedido de esa rafaga
 * fallo con "fetch failed": se cayeron a la vez la lectura de la conexion de WhatsApp y el guardado del mensaje.
 * Pasa en rafagas cortas (hoy tambien en la copia de Google Calendar) y un segundo intento ya sale bien.
 *
 * Que se reintenta, y solo eso:
 * - Un GOAWAY, en cualquier metodo: el servidor avisa que la conexion se cierra y que el pedido NO se proceso, asi
 *   que repetirlo no puede duplicar nada.
 * - Otros cortes de la conexion (reset, socket cerrado), solo en GET y HEAD: en un POST no se sabe si el servidor
 *   llego a procesarlo, y repetirlo podria escribir dos veces.
 * - Nunca una cancelacion (`AbortError`): la pidio quien llama.
 *
 * Es un modulo puro: no importa nada de Next ni de Supabase, y se prueba con un `fetch` simulado.
 */

/** Espera antes de cada reintento: dos reintentos, cortos, para no demorar un pedido que va a salir bien. */
export const RETRY_DELAYS_MS = [150, 400] as const;

const RETRYABLE_ON_ANY_METHOD = /GOAWAY/i;
const RETRYABLE_ON_SAFE_METHODS = /ECONNRESET|UND_ERR_SOCKET|EPIPE|ERR_HTTP2_STREAM_ERROR|ERR_HTTP2_STREAM_CANCEL|other side closed/i;

/** Todo el texto util de un error y de sus causas encadenadas (el motivo real de un "fetch failed" viene en `cause`). */
function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.name, current.message);
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") parts.push(code);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(" ");
}

/** Si el pedido que fallo se puede repetir sin riesgo. */
export function isRetryableNetworkError(error: unknown, method: string): boolean {
  if (error instanceof Error && error.name === "AbortError") return false;
  const text = errorChainText(error);
  if (/AbortError/.test(text)) return false;
  if (RETRYABLE_ON_ANY_METHOD.test(text)) return true;
  const safe = method === "GET" || method === "HEAD";
  return safe && RETRYABLE_ON_SAFE_METHODS.test(text);
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

interface RetryingFetchOptions {
  /** El `fetch` de verdad (en las pruebas, uno simulado). */
  fetchImpl?: typeof fetch;
  /** La espera entre intentos (en las pruebas, una que no espera). */
  sleep?: (ms: number) => Promise<void>;
}

/** Un `fetch` que reintenta los cortes de red seguros. Si no se puede recuperar, lanza el MISMO error de siempre. */
export function createRetryingFetch(options: RetryingFetchOptions = {}): typeof fetch {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const doFetch = options.fetchImpl ?? globalThis.fetch;
    const method = methodOf(input, init);
    // Un `Request` con cuerpo se consume al mandarlo: cada intento usa una copia.
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const template = isRequest ? (input as Request).clone() : null;

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await doFetch(template ? template.clone() : input, init);
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !isRetryableNetworkError(error, method)) throw error;
        await sleep(delay);
      }
    }
  };
}

/** El que usan los clientes de servidor de Supabase. */
export const retryingFetch: typeof fetch = createRetryingFetch();
