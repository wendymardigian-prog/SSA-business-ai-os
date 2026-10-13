/** El modo "escuchar el proximo envio" (F5): dura 15 minutos y se apaga solo. */
export const LISTEN_MINUTES = 15;

export function listenUntilFrom(now: Date): Date {
  return new Date(now.getTime() + LISTEN_MINUTES * 60 * 1000);
}

/** Una escucha vencida (o ilegible) cuenta como "no escuchando". */
export function isListening(now: Date, listenUntil: string | null | undefined): boolean {
  if (!listenUntil) return false;
  const until = new Date(listenUntil).getTime();
  return Number.isFinite(until) && until > now.getTime();
}
