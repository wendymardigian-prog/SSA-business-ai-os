/**
 * Qué disparadores ofrecen el «Solo si…» genérico, sin importar el registro (lo usa el panel, que corre en el
 * navegador). Son los que pasan por la cola de eventos; los de esta lista no: los de mensajes y comentarios tienen sus
 * filtros, el webhook tiene su propio «Solo si…» y los demás arrancan por otro camino (cron, receptor de emails).
 * `trigger-only-if.test.ts` compara esta lista con el registro (`supportsTriggerOnlyIf`).
 */
export const TRIGGERS_WITHOUT_ONLY_IF = [
  "keyword",
  "postback",
  "quick_reply",
  "welcome",
  "default",
  "comment_keyword",
  "email_received",
  "inactivity",
  "scheduled_time",
  "webhook_received",
] as const;

export function triggerOffersOnlyIf(type: string | null | undefined): boolean {
  if (!type) return false;
  return !(TRIGGERS_WITHOUT_ONLY_IF as readonly string[]).includes(type);
}
