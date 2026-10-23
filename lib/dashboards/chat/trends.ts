/**
 * Las cuatro pestañas de Tendencias, y el paso a semanal.
 *
 * Reglas del modulo:
 *
 *   - **Arriba de 62 dias se agrupa por semana** (§15.2). Noventa barras de un
 *     pixel no son un grafico.
 *   - **La semana arranca el lunes**, como el resto del sistema.
 *   - **El tiempo de respuesta (00261) se agrupa con suma y cantidad**, nunca
 *     promediando promedios: un dia con una espera no pesa lo mismo que uno con
 *     cien. Un grupo sin ninguna espera respondida queda en null (hueco), no en
 *     cero.
 */

import type { AuthorGroup } from "./types";

/** Una fila de la funcion SQL `chat_dashboard_trends`. */
export interface TrendRow {
  day: string;
  messages_in: number;
  messages_out: number;
  new_conversations: number;
  sent_agent: number;
  sent_team: number;
  sent_automations: number;
  sent_external: number;
  /** Queda en la funcion SQL para volver atras; la app ya no la usa (00261). */
  first_response_median_seconds?: number | null;
  /** Las esperas respondidas ese dia y la suma de sus tiempos (de `withResponseTimes`). */
  response_turns?: number;
  response_total_seconds?: number;
}

/** Una fila de `chat_dashboard_response_time_daily` (00261). */
export interface ResponseDayRow {
  day: string;
  turns: number;
  total_seconds: number | null;
}

/** Junta la serie del tiempo de respuesta con la diaria, por dia. */
export function withResponseTimes(rows: TrendRow[], response: ResponseDayRow[]): TrendRow[] {
  const byDay = new Map(response.map((r) => [r.day, r]));
  return rows.map((row) => {
    const r = byDay.get(row.day);
    return { ...row, response_turns: Number(r?.turns ?? 0), response_total_seconds: Number(r?.total_seconds ?? 0) };
  });
}

/** Un grupo del grafico: un dia o una semana. */
export interface TrendBucket {
  /** Clave ISO del grupo (el dia, o el lunes de la semana). */
  key: string;
  /** Fin del grupo (igual a `key` cuando es un dia). */
  end: string;
  messagesIn: number;
  messagesOut: number;
  newConversations: number;
  sent: Record<AuthorGroup, number>;
  /** Esperas respondidas (por personas, o por el autor filtrado) y la suma de sus tiempos. */
  responseTurns: number;
  responseTotalSeconds: number;
}

/** El promedio de un grupo. Sin esperas respondidas, null (hueco), no cero. */
export function averageResponse(group: { responseTurns: number; responseTotalSeconds: number }): number | null {
  return group.responseTurns > 0 ? group.responseTotalSeconds / group.responseTurns : null;
}

export const WEEKLY_THRESHOLD_DAYS = 62;

/** ¿El periodo es tan largo que conviene agrupar por semana? */
export function shouldGroupWeekly(days: number): boolean {
  return days > WEEKLY_THRESHOLD_DAYS;
}

/** El lunes de la semana de una fecha ISO (YYYY-MM-DD), como fecha ISO. */
export function mondayOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = domingo
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** La mediana de una lista de numeros. Lista vacia = null, no 0. */
export function median(values: number[]): number | null {
  const real = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (real.length === 0) return null;
  const mid = Math.floor(real.length / 2);
  return real.length % 2 ? real[mid] : (real[mid - 1] + real[mid]) / 2;
}

function emptySent(): Record<AuthorGroup, number> {
  return { agent: 0, team: 0, automations: 0, external: 0 };
}

/** Un dia de la serie SQL, como grupo del grafico. */
function toBucket(row: TrendRow): TrendBucket {
  return {
    key: row.day,
    end: row.day,
    messagesIn: Number(row.messages_in ?? 0),
    messagesOut: Number(row.messages_out ?? 0),
    newConversations: Number(row.new_conversations ?? 0),
    sent: {
      agent: Number(row.sent_agent ?? 0),
      team: Number(row.sent_team ?? 0),
      automations: Number(row.sent_automations ?? 0),
      external: Number(row.sent_external ?? 0),
    },
    responseTurns: Number(row.response_turns ?? 0),
    responseTotalSeconds: Number(row.response_total_seconds ?? 0),
  };
}

/**
 * Agrupa la serie diaria. Con `weekly`, por semana (lunes a domingo); si no,
 * devuelve los dias tal cual.
 */
export function bucketTrends(rows: TrendRow[], weekly: boolean): TrendBucket[] {
  const days = rows.map(toBucket);
  if (!weekly) return days;

  const byWeek = new Map<string, TrendBucket>();
  for (const day of days) {
    const key = mondayOf(day.key);
    const b = byWeek.get(key);
    if (!b) {
      byWeek.set(key, { ...day, key, end: day.key, sent: { ...day.sent } });
      continue;
    }
    b.end = day.key;
    b.messagesIn += day.messagesIn;
    b.messagesOut += day.messagesOut;
    b.newConversations += day.newConversations;
    for (const g of Object.keys(b.sent) as AuthorGroup[]) b.sent[g] += day.sent[g];
    b.responseTurns += day.responseTurns;
    b.responseTotalSeconds += day.responseTotalSeconds;
  }

  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => bucket);
}

/** Totales del periodo, para la linea de arriba del grafico. */
export function trendTotals(buckets: TrendBucket[]): {
  messagesIn: number;
  messagesOut: number;
  newConversations: number;
  sent: Record<AuthorGroup, number>;
  responseTurns: number;
  responseTotalSeconds: number;
} {
  const sent = emptySent();
  let messagesIn = 0;
  let messagesOut = 0;
  let newConversations = 0;
  let responseTurns = 0;
  let responseTotalSeconds = 0;
  for (const b of buckets) {
    messagesIn += b.messagesIn;
    messagesOut += b.messagesOut;
    newConversations += b.newConversations;
    for (const g of Object.keys(sent) as AuthorGroup[]) sent[g] += b.sent[g];
    responseTurns += b.responseTurns;
    responseTotalSeconds += b.responseTotalSeconds;
  }
  return { messagesIn, messagesOut, newConversations, sent, responseTurns, responseTotalSeconds };
}

export type TrendTab = "conversaciones" | "mensajes" | "autores" | "tiempo-respuesta";

export const TREND_TABS: TrendTab[] = ["conversaciones", "mensajes", "autores", "tiempo-respuesta"];

export function isTrendTab(value: string): value is TrendTab {
  return (TREND_TABS as string[]).includes(value);
}

/** El nombre de cada pestaña. La primera cambia con el filtro de autor. */
export function trendTabLabel(tab: TrendTab, filteredByAuthor: boolean): string {
  switch (tab) {
    case "conversaciones":
      return filteredByAuthor ? "Conversaciones" : "Conversaciones nuevas";
    case "mensajes":
      return "Mensajes recibidos y enviados";
    case "autores":
      return "Enviados por autor";
    case "tiempo-respuesta":
      return "Tiempo de respuesta";
  }
}

/**
 * Cuantos dias cubre un rango.
 *
 * Se redondea para arriba y no se suma uno: los rangos arrancan a las 00:00 y
 * terminan a las 23:59:59.999, asi que del 22 al 28 hay 6,99 dias de diferencia
 * y son 7 dias. Sumar uno contaba ocho y adelantaba el paso a semanal.
 */
export function daysBetween(fromIso: string | null, toIso: string | null, now: Date = new Date()): number {
  if (!fromIso) return Number.POSITIVE_INFINITY; // Historico: siempre semanal
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : now.getTime();
  return Math.max(1, Math.ceil((to - from) / 86_400_000));
}
