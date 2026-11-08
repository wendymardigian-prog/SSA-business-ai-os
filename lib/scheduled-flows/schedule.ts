/**
 * «En una fecha y hora» (`scheduled_time`): una automatización que arranca sola, el día y la hora que se eligen, una vez
 * o repetida. Las reglas son PURAS y sirven en el navegador: las usan el panel del lienzo, la validación al publicar y el
 * trabajo de la cola que la corre.
 *
 *   - La hora es SIEMPRE la del negocio (`workspaces.timezone`): es una regla del flujo y no puede depender de quién la
 *     armó ni de quién la mira. «Lunes a las 9» sigue siendo a las 9 cuando cambia el horario de verano.
 *   - Cuatro formas: una vez (fecha + hora), todos los días, ciertos días de la semana o un día del mes. Un día del mes
 *     que ese mes no tiene (el 31 en abril) cae el último día del mes.
 *   - La automatización no tiene contacto ni persona (`subject: "system"`): sirve para mandar una encuesta a un grupo,
 *     un aviso al equipo, un email a una dirección fija...
 */
import { civilDate, datetimeInputToIso } from "@/lib/dates";

export const SCHEDULED_TRIGGER_TYPE = "scheduled_time";

/** El trabajo de la cola que corre cada fecha y hora (`scheduled_jobs.type`). */
export const SCHEDULED_RUN_JOB = "flow_scheduled_run";

export type ScheduleRepeat = "once" | "daily" | "weekly" | "monthly";
export const SCHEDULE_REPEATS: readonly ScheduleRepeat[] = ["once", "daily", "weekly", "monthly"];

export interface ScheduleConfig {
  repeat: ScheduleRepeat;
  /** Solo «una vez»: `AAAA-MM-DD`. */
  date: string | null;
  /** `HH:mm`, en la hora del negocio. */
  time: string | null;
  /** Solo «cada semana»: 0 = domingo … 6 = sábado, sin repetidos y ordenados. */
  weekdays: number[];
  /** Solo «cada mes»: 1 a 31. */
  monthDay: number | null;
}

/**
 * Cuánto tarde todavía se corre una fecha y hora (si la app estuvo caída, por ejemplo). Pasado eso se saltea esa vez y
 * se agenda la siguiente: una encuesta de las 9 que sale a las 18 confunde más de lo que ayuda.
 */
export const MAX_LATE_MINUTES = 120;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;
const WEEKDAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;

function validDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return value.trim();
}

function validTime(value: unknown): string | null {
  return typeof value === "string" && TIME_RE.test(value.trim()) ? value.trim() : null;
}

/** La config guardada (en el nodo o en `triggers.config`), leída con tolerancia: lo que no sirve queda vacío. */
export function parseScheduleConfig(raw: unknown): ScheduleConfig {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const repeat = SCHEDULE_REPEATS.includes(data.repeat as ScheduleRepeat) ? (data.repeat as ScheduleRepeat) : "once";
  const weekdays = Array.isArray(data.weekdays)
    ? [...new Set(data.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
    : [];
  const day = Number(data.monthDay);
  return {
    repeat,
    date: validDate(data.date),
    time: validTime(data.time),
    weekdays,
    monthDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
  };
}

export const SCHEDULE_NO_TIME_PROBLEM = "Elegí la hora en el disparador «En una fecha y hora».";
export const SCHEDULE_NO_DATE_PROBLEM = "Elegí la fecha en el disparador «En una fecha y hora».";
export const SCHEDULE_NO_WEEKDAYS_PROBLEM = "Elegí al menos un día de la semana en el disparador «En una fecha y hora».";
export const SCHEDULE_NO_MONTH_DAY_PROBLEM = "Elegí el día del mes en el disparador «En una fecha y hora».";
export const SCHEDULE_PAST_PROBLEM = "La fecha y hora del disparador ya pasó: elegí una que todavía no llegó.";

/** Lo que le falta a la config para poder publicarse (sin mirar si la fecha ya pasó: eso pide la zona del negocio). */
export function scheduleProblems(raw: unknown): string[] {
  const config = parseScheduleConfig(raw);
  const problems: string[] = [];
  if (config.repeat === "once" && !config.date) problems.push(SCHEDULE_NO_DATE_PROBLEM);
  if (!config.time) problems.push(SCHEDULE_NO_TIME_PROBLEM);
  if (config.repeat === "weekly" && config.weekdays.length === 0) problems.push(SCHEDULE_NO_WEEKDAYS_PROBLEM);
  if (config.repeat === "monthly" && !config.monthDay) problems.push(SCHEDULE_NO_MONTH_DAY_PROBLEM);
  return problems;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** El instante de esa hora de pared en la zona, o null si no se puede armar. */
function atWallClock(year: number, month: number, day: number, time: string, timeZone: string): Date | null {
  const iso = datetimeInputToIso(`${year}-${pad(month)}-${pad(day)}T${time}`, timeZone);
  return iso ? new Date(iso) : null;
}

/** Cuántos días del calendario se recorren buscando la próxima vez (un año y algo: alcanza para «cada mes»). */
const SEARCH_DAYS = 400;

/**
 * La próxima fecha y hora ESTRICTAMENTE después de `after`, en la zona del negocio. null si no hay ninguna (una sola
 * vez que ya pasó) o si la config no alcanza.
 */
export function nextOccurrence(raw: unknown, after: Date, timeZone: string): Date | null {
  const config = parseScheduleConfig(raw);
  const time = config.time;
  if (!time) return null;

  if (config.repeat === "once") {
    if (!config.date) return null;
    const [y, m, d] = config.date.split("-").map(Number);
    const at = atWallClock(y, m, d, time, timeZone);
    return at && at.getTime() > after.getTime() ? at : null;
  }
  if (config.repeat === "weekly" && config.weekdays.length === 0) return null;
  if (config.repeat === "monthly" && !config.monthDay) return null;

  // Desde el día de `after` en la zona del negocio (ese mismo día puede tener una hora que todavía no llegó).
  const start = civilDate(after, timeZone);
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    if (config.repeat === "weekly" && !config.weekdays.includes(cursor.getUTCDay())) continue;
    if (config.repeat === "monthly" && day !== Math.min(config.monthDay!, daysInMonth(year, month))) continue;
    const at = atWallClock(year, month, day, time, timeZone);
    if (at && at.getTime() > after.getTime()) return at;
  }
  return null;
}

/** Si ESTE instante es una de las veces de la config (para descartar un trabajo de una config vieja). */
export function isOccurrenceOf(raw: unknown, occurrence: Date, timeZone: string): boolean {
  const next = nextOccurrence(raw, new Date(occurrence.getTime() - 1), timeZone);
  return next !== null && next.getTime() === occurrence.getTime();
}

/** Si esa vez se corre todavía o ya es demasiado tarde (ver `MAX_LATE_MINUTES`). */
export function isTooLate(occurrence: Date, now: Date): boolean {
  return now.getTime() - occurrence.getTime() > MAX_LATE_MINUTES * 60_000;
}

/** «el lunes, miércoles y viernes» / «el lunes». */
function weekdayList(days: number[]): string {
  const names = days.map((d) => WEEKDAY_LABELS[d].toLowerCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** Cómo se lee la config, para el nodo del lienzo y el panel: «Todos los lunes y jueves a las 09:00». */
export function describeSchedule(raw: unknown): string {
  const config = parseScheduleConfig(raw);
  const at = config.time ? ` a las ${config.time}` : "";
  switch (config.repeat) {
    case "once": {
      if (!config.date) return "Elegí la fecha y la hora";
      const [y, m, d] = config.date.split("-").map(Number);
      return `El ${d} de ${MONTHS[m - 1]} de ${y}${at}`;
    }
    case "daily":
      return `Todos los días${at}`;
    case "weekly":
      if (config.weekdays.length === 0) return "Elegí los días de la semana";
      if (config.weekdays.length === 7) return `Todos los días${at}`;
      return `Cada ${weekdayList(config.weekdays)}${at}`;
    case "monthly":
      return config.monthDay ? `El día ${config.monthDay} de cada mes${at}` : "Elegí el día del mes";
  }
}

/**
 * Las variables que el disparador le deja al flujo, en la hora del negocio: `{{schedule.date}}` («9 de noviembre de
 * 2026»), `{{schedule.weekday}}` («lunes») y `{{schedule.time}}` («09:00»).
 */
export function scheduleVariables(occurrence: Date, timeZone: string): Record<string, unknown> {
  const { year, month, day } = civilDate(occurrence, timeZone);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(occurrence);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    schedule: {
      date: `${day} de ${MONTHS[month - 1]} de ${year}`,
      weekday: WEEKDAY_LABELS[weekday].toLowerCase(),
      time: `${pad(Number(get("hour")) % 24)}:${get("minute")}`,
      date_iso: `${year}-${pad(month)}-${pad(day)}`,
    },
  };
}

/** Las variables que el selector del lienzo ofrece (las de `scheduleVariables`). */
export const SCHEDULE_VARIABLE_PATHS = ["schedule.date", "schedule.weekday", "schedule.time"] as const;

/** Etiqueta corta de un día, para los botones del panel. */
export function weekdayShort(day: number): string {
  return WEEKDAY_SHORT[day] ?? "";
}

/** La clave del trabajo de una vez (`scheduled_jobs.dedupe_key`): agendar dos veces la misma vez no crea dos trabajos. */
export function scheduledRunKey(flowId: string, occurrence: Date): string {
  return `${SCHEDULED_RUN_JOB}:${flowId}:${occurrence.toISOString()}`;
}

/** La clave del disparo (`trigger_fires.dedupe_key`): una misma vez corre una sola vez aunque el trabajo se repita. */
export function scheduledFireKey(occurrence: Date): string {
  return `schedule:${occurrence.toISOString()}`;
}

/** Lo que viaja en el trabajo de la cola. */
export interface ScheduledRunPayload {
  workspaceId: string;
  flowId: string;
  /** La versión publicada que lo agendó: si se volvió a publicar, ese trabajo es viejo y no corre. */
  version: number;
  /** La vez que corre, en ISO. */
  occurrence: string;
}

export function parseScheduledRunPayload(raw: unknown): ScheduledRunPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.workspaceId !== "string" || typeof p.flowId !== "string" || typeof p.occurrence !== "string") return null;
  const version = Number(p.version);
  if (!Number.isInteger(version) || Number.isNaN(new Date(p.occurrence).getTime())) return null;
  return { workspaceId: p.workspaceId, flowId: p.flowId, version, occurrence: p.occurrence };
}
