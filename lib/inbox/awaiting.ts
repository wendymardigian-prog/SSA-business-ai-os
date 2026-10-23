/**
 * "Esperando respuesta" en la bandeja: el filtro, la marca y sus textos.
 *
 * La base guarda el estado en la conversacion (00259, lo mantiene el trigger de
 * messages): desde cuando espera el lead, hasta cuando se puede responder desde
 * el sistema y si la tanda no necesita respuesta. Aca se decide que significa
 * eso para la pantalla, con EL MISMO criterio que `chat_waiting_now_v2` del
 * dashboard: asi "6 esperando" en el dashboard son las 6 que muestra el filtro.
 *
 *   - Esperando = el ultimo mensaje es del lead, hace mas de 1 hora, la
 *     conversacion esta abierta, el contacto no esta en "no contactar", ninguna
 *     etiqueta apago al agente y nadie marco que no necesita respuesta.
 *   - "Se puede responder" = la ventana del canal sigue abierta (o no tiene).
 *   - "Ventana vencida" = ya paso (Instagram: 24 h desde el ultimo mensaje del
 *     lead). Se responde desde la app de la red, no desde aca.
 *
 * Modulo PURO.
 */

/** El parametro de la URL del filtro. */
export const AWAITING_PARAM = "esperando";

export const AWAITING_FILTER_VALUES = ["responder", "vencida"] as const;
export type AwaitingFilter = (typeof AWAITING_FILTER_VALUES)[number];

export const AWAITING_FILTER_LABELS: Record<AwaitingFilter, string> = {
  responder: "Esperando respuesta",
  vencida: "Sin respuesta, ventana vencida",
};

/** Cuanto tiene que esperar el lead para contar (mismo valor que el SQL). */
export const AWAITING_MIN_MINUTES = 60;

export function parseAwaitingFilter(raw: string | null | undefined): AwaitingFilter | "" {
  return raw && (AWAITING_FILTER_VALUES as readonly string[]).includes(raw) ? (raw as AwaitingFilter) : "";
}

/** Las columnas de la conversacion que alcanzan para decidir. */
export interface AwaitingRow {
  status?: string | null;
  awaiting_last_inbound_at?: string | null;
  reply_window_until?: string | null;
  no_reply_needed_at?: string | null;
  no_reply_needed_reason?: string | null;
  agent_disabled_by_tag_id?: string | null;
  contacts?: { do_not_contact?: boolean | null } | null;
}

export type AwaitingState = "none" | "can_reply" | "window_closed" | "no_reply_needed";

/**
 * El estado de una conversacion ahora. `none` = no espera (o espera hace menos
 * de una hora, o esta cerrada, o es de alguien en "no contactar").
 */
export function awaitingState(row: AwaitingRow, now: Date = new Date()): AwaitingState {
  if (!row.awaiting_last_inbound_at) return "none";
  if (row.status && row.status !== "open") return "none";
  if (row.agent_disabled_by_tag_id) return "none";
  if (row.contacts?.do_not_contact) return "none";
  const last = Date.parse(row.awaiting_last_inbound_at);
  if (Number.isNaN(last) || now.getTime() - last <= AWAITING_MIN_MINUTES * 60_000) return "none";
  if (row.no_reply_needed_at) return "no_reply_needed";
  if (row.reply_window_until && Date.parse(row.reply_window_until) <= now.getTime()) return "window_closed";
  return "can_reply";
}

/** Si una fila entra en el filtro elegido. Sin filtro, todas. */
export function matchesAwaitingFilter(row: AwaitingRow, filter: AwaitingFilter | "", now: Date = new Date()): boolean {
  if (!filter) return true;
  const state = awaitingState(row, now);
  return filter === "responder" ? state === "can_reply" : state === "window_closed";
}

/**
 * Los limites de tiempo para la consulta del servidor: el filtro se resuelve en
 * la base con estas dos fechas (no se puede pedir "now() - 1 hora" por la URL).
 */
export function awaitingQueryBounds(now: Date = new Date()): { waitingBefore: string; nowIso: string } {
  return {
    waitingBefore: new Date(now.getTime() - AWAITING_MIN_MINUTES * 60_000).toISOString(),
    nowIso: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// La marca "no necesita respuesta"
// ---------------------------------------------------------------------------

export interface NoReplyBadge {
  show: boolean;
  label: string;
  /** Quien lo decidio, para el title y el aviso del hilo. */
  detail: string;
}

const NO_REPLY_LABEL = "No necesita respuesta";

const REASON_DETAIL: Record<string, string> = {
  rule: "El último mensaje solo cierra la charla (un agradecimiento, un ok o un emoji).",
  agent: "El agente decidió que el último mensaje no necesita respuesta.",
  manual: "Alguien del equipo la marcó así.",
};

/**
 * La marca, solo mientras el lead no volvio a escribir (la base la borra sola
 * cuando escribe o le respondemos).
 */
export function noReplyBadge(row: Pick<AwaitingRow, "no_reply_needed_at" | "no_reply_needed_reason" | "awaiting_last_inbound_at">): NoReplyBadge {
  if (!row.no_reply_needed_at || !row.awaiting_last_inbound_at) {
    return { show: false, label: NO_REPLY_LABEL, detail: "" };
  }
  return {
    show: true,
    label: NO_REPLY_LABEL,
    detail: REASON_DETAIL[row.no_reply_needed_reason ?? ""] ?? REASON_DETAIL.manual,
  };
}

/** ¿Tiene sentido ofrecer "Marcar como que no necesita respuesta"? Solo si el lead espera. */
export function canMarkNoReply(row: Pick<AwaitingRow, "no_reply_needed_at" | "awaiting_last_inbound_at">): boolean {
  return Boolean(row.awaiting_last_inbound_at) && !row.no_reply_needed_at;
}
