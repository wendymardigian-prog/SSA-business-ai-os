/**
 * El recordatorio del reporte de fin de día (E13). Puro.
 *
 * El cron encola un barrido por reporte cada 15 minutos; el barrido le avisa a cada persona
 * de la audiencia cuando en SU zona horaria ya es la hora elegida (dentro de una ventana de
 * 30 minutos, por si una corrida se atrasa) y todavía no envió el de hoy. Un aviso por
 * persona, reporte y día: el barrido mira si ya lo mandó.
 */
import { todayInputValue, zonedClock } from "@/lib/dates";
import type { EodConfig } from "./config";

export const REMINDER_WINDOW_MINUTES = 30;

function minutesOf(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** ¿Le toca el aviso ahora a alguien en esta zona? Y de qué día. */
export function reminderDue(config: Pick<EodConfig, "reminder">, now: Date, timeZone: string): { due: boolean; date: string } {
  const date = todayInputValue(now, timeZone);
  if (!config.reminder.enabled) return { due: false, date };
  const target = minutesOf(config.reminder.time);
  if (target === null) return { due: false, date };
  const { minutes } = zonedClock(now, timeZone);
  return { due: minutes >= target && minutes < target + REMINDER_WINDOW_MINUTES, date };
}

/** A quiénes avisar: los de la audiencia a los que les toca ahora, sin enviado hoy ni aviso previo. */
export function remindersToSend(input: {
  config: Pick<EodConfig, "reminder">;
  now: Date;
  people: Array<{ userId: string; timeZone: string }>;
  /** `<userId>:<fecha>` de los reportes ya enviados. */
  submitted: Set<string>;
  /** `<userId>:<fecha>` de los avisos ya mandados. */
  reminded: Set<string>;
}): Array<{ userId: string; date: string }> {
  return input.people.flatMap((p) => {
    const { due, date } = reminderDue(input.config, input.now, p.timeZone);
    const key = `${p.userId}:${date}`;
    return due && !input.submitted.has(key) && !input.reminded.has(key) ? [{ userId: p.userId, date }] : [];
  });
}
