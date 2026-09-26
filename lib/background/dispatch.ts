import { civilDate } from "@/lib/dates";
import type { TaskFrequency } from "./settings";

/**
 * Ventana de despacho de una tarea en lote (F24). Devuelve el identificador de
 * la ocurrencia programada más reciente en la zona del workspace, a la que le
 * corresponde una corrida. El `dedupe_key` se arma con esto, así correr el cron
 * dos veces en la misma ventana no crea dos corridas.
 */

function tzClock(now: Date, timeZone: string): { date: string; hour: number; minute: number; weekday: number } {
  const c = civilDate(now, timeZone);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`, hour, minute: Number(get("minute")), weekday };
}

function addDaysStr(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + delta));
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(nd.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Ventana que corresponde correr ahora, o null si todavía no llegó ninguna hoy.
 * @param hour "HH:MM" configurada (para daily/weekly).
 */
export function dueWindow(frequency: TaskFrequency, hour: string, now: Date, timeZone: string): string | null {
  const c = tzClock(now, timeZone);
  const [targetH, targetM] = hour.split(":").map(Number);
  const pastHour = c.hour > targetH || (c.hour === targetH && c.minute >= (targetM ?? 0));

  switch (frequency) {
    case "hourly":
      return `${c.date}T${String(c.hour).padStart(2, "0")}`;
    case "every6h": {
      const bucket = Math.floor(c.hour / 6) * 6;
      return `${c.date}T${String(bucket).padStart(2, "0")}`;
    }
    case "daily":
      // La ventana de hoy si ya pasó la hora; si no, la de ayer.
      return pastHour ? c.date : addDaysStr(c.date, -1);
    case "weekly": {
      // Lunes de esta semana; si es antes del lunes+hora, la semana pasada.
      const back = c.weekday === 0 ? 6 : c.weekday - 1;
      const thisMonday = addDaysStr(c.date, -back);
      if (back === 0 && !pastHour) return addDaysStr(thisMonday, -7);
      return thisMonday;
    }
  }
}

/** dedupe_key de una corrida por ventana. */
export function dispatchDedupeKey(workspaceId: string, task: string, window: string): string {
  return `bg:${workspaceId}:${task}:${window}`;
}
