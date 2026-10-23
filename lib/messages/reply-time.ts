/**
 * El tiempo de respuesta: cuanto espero el lead hasta que le contestamos.
 *
 * Una "espera" (turno del lead) es una tanda de mensajes seguidos del lead. La
 * cierra el primer mensaje que sale despues, de quien sea. El tiempo se cuenta
 * desde el PRIMER mensaje sin responder de la tanda: si el lead escribe "hola" a
 * las 10:00 y la pregunta a las 10:20, espero desde las 10:00.
 *
 * Quien respondio importa para el dashboard, que mide a las PERSONAS:
 *
 *   - Una persona desde el sistema (`origin = 'user'`): humana.
 *   - Un borrador del agente aprobado (`origin = 'agent'` con `sent_by_user_id`):
 *     humana. Cuando salio lo decidio quien lo aprobo.
 *   - El agente en envio directo (`origin = 'agent'` sin persona): automatica.
 *   - Flows, secuencias y broadcasts: automatica.
 *   - Fuera del sistema (`external`, por ejemplo desde la app de Instagram):
 *     humana, SALVO que salga en menos de 15 segundos despues del ultimo mensaje
 *     del lead. Nadie escribe tan rapido: eso es otra herramienta respondiendo
 *     sola (ManyChat). El sistema no tiene otra forma de distinguirlas.
 *
 * `isHumanReply` es GEMELA de `public.chat_reply_is_human` (SQL, 00261), con los
 * casos de `reply-time.cases.json`. `replyTimesByMessage` arma, para la bandeja,
 * el mismo calculo que `public.chat_response_turns` hace en la base: el numero
 * del chat y el del dashboard no se pueden contradecir.
 *
 * Modulo PURO.
 */

/** Por debajo de esto, una respuesta de fuera del sistema es automatica. */
export const AUTOMATIC_REPLY_MAX_SECONDS = 15;

export interface ReplyAuthor {
  origin: string | null;
  sentByUserId: string | null;
  /** Segundos entre el ultimo mensaje del lead de la tanda y esta respuesta. */
  secondsSinceLastInbound: number;
}

/** ¿Esta respuesta la dio una persona? */
export function isHumanReply(reply: ReplyAuthor): boolean {
  switch (reply.origin) {
    case "user":
      return true;
    case "agent":
      return reply.sentByUserId !== null;
    case "flow":
    case "sequence":
    case "broadcast":
      return false;
    default:
      // external, o un saliente viejo sin origen.
      return reply.secondsSinceLastInbound >= AUTOMATIC_REPLY_MAX_SECONDS;
  }
}

export interface ThreadMessage {
  id: string;
  direction: string;
  created_at: string;
  status?: string | null;
  origin?: string | null;
  sent_by_user_id?: string | null;
}

export interface MessageReplyTime {
  /** Segundos desde el primer mensaje sin responder del lead. */
  seconds: number;
  human: boolean;
}

/**
 * Para cada mensaje que salio y CERRO una espera del lead, cuanto tardo. Los
 * demas salientes (el segundo de una tanda nuestra) no estan en el mapa.
 *
 * Un envio que fallo no le llego al lead: no cierra la espera, y la siguiente
 * respuesta que si salio se mide desde el mismo mensaje.
 */
export function replyTimesByMessage(messages: readonly ThreadMessage[]): Map<string, MessageReplyTime> {
  const out = new Map<string, MessageReplyTime>();
  const sorted = [...messages].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  let firstWaiting: number | null = null;
  let lastWaiting: number | null = null;
  for (const m of sorted) {
    const at = Date.parse(m.created_at);
    if (Number.isNaN(at)) continue;
    if (m.direction === "inbound") {
      if (firstWaiting === null) firstWaiting = at;
      lastWaiting = at;
      continue;
    }
    if (m.direction !== "outbound" || m.status === "failed") continue;
    if (firstWaiting === null || lastWaiting === null) continue;
    out.set(m.id, {
      seconds: Math.max(0, (at - firstWaiting) / 1000),
      human: isHumanReply({
        origin: m.origin ?? null,
        sentByUserId: m.sent_by_user_id ?? null,
        secondsSinceLastInbound: Math.max(0, (at - lastWaiting) / 1000),
      }),
    });
    firstWaiting = null;
    lastWaiting = null;
  }
  return out;
}

/** "12 s", "4 min", "2 h 15 min", "3 d 4 h". Corto, para al lado de la hora. */
export function formatReplyTime(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}
