/**
 * Lógica de la tabla "Quién responde" (F18): umbrales de color por tiempo.
 */
export type TimeTone = "ok" | "warn" | "bad";

/** > 4 h rojo, > 1 h ámbar, si no ok. Con ícono además del color (accesible). */
export function timeTone(seconds: number | null): TimeTone {
  if (seconds === null || !Number.isFinite(seconds)) return "ok";
  if (seconds > 4 * 3600) return "bad";
  if (seconds > 3600) return "warn";
  return "ok";
}

export interface TeamRow {
  author: string;
  messagesOut: number;
  firstResponseMedianSeconds: number | null;
  replyMedianSeconds: number | null;
  repliesUnder1hPct: number | null;
}

/** Ordena por cantidad de salientes desc; el agente primero si empata arriba. */
export function sortTeam(rows: TeamRow[]): TeamRow[] {
  return [...rows].sort((a, b) => {
    if (a.author === "agent") return -1;
    if (b.author === "agent") return 1;
    return b.messagesOut - a.messagesOut;
  });
}
