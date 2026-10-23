/**
 * Llamadas de WhatsApp (00258), puro: entender el evento CALL de Evolution y
 * decir que paso, para el hilo y la lista.
 *
 * Evolution 2.3.7 manda en `data` el evento de Baileys tal cual:
 * `{ id, from, chatId, isGroup, isVideo, status, date, offline }`, con
 * `status` = offer | ringing | accept | reject | timeout | terminate. Un evento
 * por cada paso de la misma llamada (mismo `id`).
 *
 * Evolution NO puede hacer ni atender llamadas: solo avisa. Por eso aca no hay
 * nada para "llamar".
 */

export const CALL_EVENTS = ["offer", "ringing", "accept", "reject", "timeout", "terminate"] as const;
export type CallEvent = (typeof CALL_EVENTS)[number];

export type CallStatus = "ringing" | "answered" | "missed" | "rejected";

export interface ParsedCallEvent {
  callId: string;
  /** El JID de quien llama (puede ser un @lid: entonces no hay telefono). */
  fromJid: string;
  isVideo: boolean;
  event: CallEvent;
  at: string;
}

/** El evento, o null si no sirve (sin id, de un grupo, con un estado que no conocemos). */
export function parseCallEvent(data: unknown, now: Date = new Date()): ParsedCallEvent | null {
  // Evolution puede mandar un objeto o una lista con uno.
  const raw = Array.isArray(data) ? data[0] : data;
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.isGroup === true || (typeof d.groupJid === "string" && d.groupJid)) return null;
  const callId = typeof d.id === "string" ? d.id.trim() : "";
  const status = typeof d.status === "string" ? d.status.toLowerCase() : "";
  if (!callId || !(CALL_EVENTS as readonly string[]).includes(status)) return null;
  const fromJid = [d.callerPn, d.from, d.chatId].find((v): v is string => typeof v === "string" && v.includes("@")) ?? "";
  if (!fromJid) return null;
  return { callId, fromJid, isVideo: d.isVideo === true, event: status as CallEvent, at: callDate(d.date, now) };
}

function callDate(value: unknown, now: Date): string {
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return now.toISOString();
}

/** Como se lee la llamada en el hilo y en la lista. */
export function callLabel(call: { status: CallStatus | string; isVideo: boolean }): string {
  const what = call.isVideo ? "Videollamada" : "Llamada de voz";
  switch (call.status) {
    case "missed":
      return `${what} perdida`;
    case "rejected":
      return `${what} rechazada`;
    case "answered":
      return `${what} atendida en el celular`;
    default:
      return `${what} entrante`;
  }
}

/** Si hay que mirarla: perdida o rechazada (alguien quiso hablar y nadie atendio). */
export function isUnansweredCall(status: string): boolean {
  return status === "missed" || status === "rejected";
}

export interface CallRow {
  id: string;
  status: CallStatus | string;
  isVideo: boolean;
  startedAt: string;
}

/**
 * Las llamadas entre los mensajes, por hora: para cada mensaje, las que
 * pasaron antes de el (y despues del anterior); al final, las posteriores al
 * ultimo. Asi el hilo las pinta sin mezclarlas con los mensajes.
 */
export function interleaveCalls<T extends { created_at: string }>(
  messages: T[],
  calls: CallRow[],
): { before: Map<number, CallRow[]>; after: CallRow[] } {
  const sorted = [...calls].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const before = new Map<number, CallRow[]>();
  let next = 0;
  messages.forEach((message, index) => {
    const group: CallRow[] = [];
    while (next < sorted.length && sorted[next].startedAt < message.created_at) group.push(sorted[next++]);
    if (group.length) before.set(index, group);
  });
  return { before, after: sorted.slice(next) };
}
