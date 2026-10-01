/**
 * ¿El agente entiende TODO lo que llego? (F10)
 *
 * **Este es el arreglo urgente de la fase.** Hoy un lead manda una nota de voz,
 * el mensaje entra con el texto vacio, el agente lo filtra del historial, y el
 * turno se agenda y responde igual: contesta sin haber escuchado nada.
 *
 * Antes de generar cualquier cosa, el turno pregunta aca. Tres respuestas:
 *
 *   - `interpretable`      todo lo de la rafaga se puede leer. Sigue normal.
 *   - `waiting`            hay un audio transcribiendose y todavia hay tiempo.
 *                          El turno se REAGENDA, no se escala: la transcripcion
 *                          tarda 2 a 5 segundos, vale esperarla.
 *   - ni una ni otra       no se puede leer. El agente NO responde: la
 *                          conversacion pasa a "necesita humano" con el motivo.
 *
 * **La regla dura: ante la duda, escala.** Es preferible que una persona
 * conteste de mas a que el bot conteste a ciegas.
 *
 * Los 90 segundos son un numero elegido, no medido: transcribir un audio de un
 * minuto tarda unos pocos segundos, asi que 90 es holgado y cubre una
 * reintentada. Si en produccion resulta corto o largo, es una constante y no un
 * rediseño. (Este modulo no sabe quien transcribe, y no tiene por que: la unica
 * puerta es lib/ai/transcribe.ts.)
 *
 * Modulo PURO.
 */

import { effectiveMessageText, unreadableReason, type MessageWithMedia } from "./effective-text";

/** Cuanto se espera una transcripcion antes de escalar. */
export const WAIT_FOR_MEDIA_MS = 90_000;

export interface InterpretabilityInput extends MessageWithMedia {
  created_at: string;
  /** Para cruzar con un trabajo de transcripcion en cola (FA4). Opcional: los tests viejos no lo necesitan. */
  id?: string;
}

export interface InterpretabilityVerdict {
  /** Si el agente puede responder. */
  interpretable: boolean;
  /** Por que no, en castellano, para la persona que va a tomarla. */
  reason: string | null;
  /** Si conviene reagendar el turno en vez de escalar. */
  waiting: boolean;
}

/**
 * Si un mensaje esta esperando algo que puede llegar.
 *
 * `retryQueued` es FA4: un 429 transitorio del proveedor de transcripción escribe `transcript_status
 * = 'failed'` y encola un reintento en `scheduled_jobs`. Sin esto la compuerta
 * veia "failed", lo trataba como ilegible DEFINITIVO, y escalaba (apagando el
 * agente) aunque la cola fuera a transcribir bien 20-30 segundos despues.
 */
function isWaiting(message: InterpretabilityInput, retryQueued: boolean): boolean {
  // Un audio en camino: o se esta transcribiendo, o todavia no arranco, o
  // fallo por algo transitorio y ya hay un reintento en la cola.
  const status = message.transcript_status;
  const audioInFlight = status === "pending" || status === "none" || status == null || (status === "failed" && retryQueued);
  if (audioInFlight) {
    const reason = unreadableReason(message);
    // Solo si lo que lo hace ilegible es justamente el audio: un video no
    // mejora esperando.
    if (reason?.includes("nota de voz") || reason?.includes("un audio")) return true;
  }

  // Una imagen sin describir todavia: el job de descripcion puede estar
  // corriendo.
  if (!message.media_description) {
    const reason = unreadableReason(message);
    if (reason?.includes("imagen")) return true;
  }

  return false;
}

/**
 * El veredicto sobre una rafaga.
 *
 * Mira TODOS los mensajes, no solo el ultimo: si el lead manda "hola" y despues
 * una nota de voz, responder solo al "hola" es contestar a medias.
 */
export function assessInterpretability(
  messages: InterpretabilityInput[],
  options: {
    now?: Date;
    waitMs?: number;
    /**
     * FA5: desde cuando se cuentan los 90 segundos. Sin esto (los tests
     * viejos y cualquier caller que no la pase), cada mensaje usa su propio
     * `created_at`, como siempre. El runner SI la pasa, y ancla los 90
     * segundos a cuando el TURNO empezo a esperar, no a cuando llego el
     * mensaje: la ventana de silencio (60s tipico) ya se habia comido mas de
     * la mitad del presupuesto antes de la primera mirada.
     */
    waitStartedAt?: Date;
    /** FA4: los ids de mensaje con un `transcribe_audio` pendiente o corriendo. */
    retryQueuedIds?: Set<string>;
  } = {},
): InterpretabilityVerdict {
  const now = options.now ?? new Date();
  const waitMs = options.waitMs ?? WAIT_FOR_MEDIA_MS;
  const retryQueuedIds = options.retryQueuedIds ?? new Set<string>();

  let waiting = false;

  for (const message of messages) {
    if (effectiveMessageText(message) !== null) continue;

    const reason = unreadableReason(message);
    // Sin texto y sin adjuntos no hay nada que interpretar: no es ilegible.
    // Puede pasar con un mensaje de sistema o un payload raro.
    if (reason === null) continue;

    const anchor = options.waitStartedAt ?? new Date(message.created_at);
    const anchorMs = anchor.getTime();
    const elapsedMs = Number.isFinite(anchorMs) ? now.getTime() - anchorMs : Number.POSITIVE_INFINITY;
    const retryQueued = message.id ? retryQueuedIds.has(message.id) : false;

    if (elapsedMs < waitMs && isWaiting(message, retryQueued)) {
      // Vale esperar, pero se sigue mirando el resto: si OTRO mensaje de la
      // rafaga es definitivamente ilegible (un video), esperar no sirve de nada
      // y hay que escalar ya.
      waiting = true;
      continue;
    }

    return { interpretable: false, reason, waiting: false };
  }

  if (waiting) return { interpretable: false, reason: null, waiting: true };

  return { interpretable: true, reason: null, waiting: false };
}
