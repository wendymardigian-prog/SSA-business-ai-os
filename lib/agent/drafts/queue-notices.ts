/**
 * Aviso para la cola cuando un borrador cambia por realtime (F6).
 *
 * Cuando un borrador se descarta porque ya se respondió por otro medio
 * (auto:answered_elsewhere) o a mano (auto:manual_reply), la fila desaparece;
 * el aviso explica por qué, para que no parezca que se perdió. Puro para
 * testearlo sin realtime.
 */
export function noticeForDraftChange(payload: {
  eventType?: string;
  new?: { status?: string | null; discard_reason?: string | null } | null;
}): string | null {
  const row = payload.new;
  if (!row || row.status !== "discarded") return null;
  const reason = row.discard_reason ?? "";
  if (reason === "auto:answered_elsewhere") {
    return "Esta conversación ya fue respondida por otro medio: saqué el borrador de la cola.";
  }
  if (reason === "auto:manual_reply") {
    return "Alguien respondió a mano esta conversación: saqué el borrador de la cola.";
  }
  return null;
}
