/**
 * Cliente de Resend — solo lo que hace falta: mandar un email.
 *
 * Se usa `fetch` contra la API REST en vez del SDK oficial: es un solo
 * endpoint, evita una dependencia mas, y se mockea limpio en los tests sin
 * depender del servicio real.
 *
 * Reintentos: hasta 3, con backoff exponencial, solo ante errores de red, 429
 * y 5xx. Un 401 (key invalida) o un 422 (remitente sin verificar) no se
 * reintentan: reintentar no los arregla y solo demora el aviso al usuario.
 *
 * La API key nunca se loguea ni se incluye en los mensajes de error.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetriable(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 429;
}

export interface ResendMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export type ResendResult =
  | { ok: true; id: string | null; attempts: number }
  | { ok: false; error: string; attempts: number };

/**
 * Manda el email. Nunca lanza: devuelve el resultado para que quien llama
 * decida que hacer y lo registre. Un email que falla no tiene que tumbar la
 * operacion que lo genero (invitar a alguien, avisar de una desconexion).
 */
export async function sendViaResend(
  apiKey: string,
  message: ResendMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendResult> {
  let lastError = "Resend no respondio";
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      const res = await fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });

      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }

      if (res.ok) {
        const id =
          typeof parsed === "object" && parsed !== null
            ? ((parsed as { id?: unknown }).id as string | undefined) ?? null
            : null;
        return { ok: true, id, attempts };
      }

      const detail =
        typeof parsed === "object" && parsed !== null
          ? ((parsed as { message?: unknown; error?: unknown }).message ??
             (parsed as { error?: unknown }).error ??
             "")
          : parsed;
      lastError = `Resend respondio ${res.status}${detail ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`;

      if (!isRetriable(res.status)) return { ok: false, error: lastError, attempts };
    } catch (err) {
      lastError = `No se pudo contactar a Resend: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  return { ok: false, error: lastError, attempts };
}
