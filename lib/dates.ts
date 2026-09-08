/**
 * Rangos de fecha para los filtros, resueltos en la zona horaria del negocio.
 *
 * Por que no alcanza con `new Date()`: los timestamps se guardan en UTC, y si
 * "hoy" se calcula en UTC, un usuario en Argentina (UTC-3) que filtra a las
 * 21:30 recibe la ventana de manana y no ve ninguno de los mensajes del dia.
 * El corte de dia tiene que hacerse en la zona en la que la persona vive.
 *
 * Hoy la zona es una constante. No hay `workspaces.timezone` todavia; cuando
 * lo haya, esto recibe la zona por parametro y no cambia nada mas.
 */

export const APP_TIMEZONE = "America/Argentina/Buenos_Aires";

export type DatePreset = "hoy" | "7d" | "30d" | "custom";

export const DATE_PRESETS: DatePreset[] = ["hoy", "7d", "30d", "custom"];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  hoy: "Hoy",
  "7d": "Ultimos 7 dias",
  "30d": "Ultimos 30 dias",
  custom: "Rango personalizado",
};

/** Cuantos dias abarca cada preset, contando el de hoy. */
const PRESET_DAYS: Record<Exclude<DatePreset, "custom">, number> = {
  hoy: 1,
  "7d": 7,
  "30d": 30,
};

export interface DateRange {
  /** Timestamp ISO en UTC, inclusive. null = sin limite inferior. */
  from: string | null;
  /** Timestamp ISO en UTC, inclusive. null = sin limite superior. */
  to: string | null;
}

const EMPTY_RANGE: DateRange = { from: null, to: null };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Cuanto se corre la zona respecto de UTC en ese instante, en milisegundos.
 * Se calcula formateando la fecha en la zona y volviendola a armar como si
 * fuera UTC: la diferencia entre las dos es el offset.
 */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Intl devuelve 24 para la medianoche con hour12:false en algunos runtimes.
  const hour = get("hour") % 24;

  // Intl no devuelve milisegundos: se le devuelven los del instante para que
  // se cancelen contra los del otro lado de la resta. Sin esto el offset sale
  // corrido por hasta 999 ms y el fin del dia queda en 03:00:00.997 en vez de
  // 02:59:59.999.
  const asIfUtc =
    Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second")) +
    instant.getUTCMilliseconds();
  return asIfUtc - instant.getTime();
}

/** El ano, mes y dia que muestra el calendario de la zona en ese instante. */
function civilDate(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Convierte una hora de pared de la zona ("2026-09-08 00:00:00 en Buenos
 * Aires") al instante UTC que le corresponde.
 *
 * La segunda pasada es para los bordes de horario de verano: el offset se
 * calcula sobre un instante aproximado, y si ese instante cae del otro lado
 * del cambio de hora, el offset corregido es distinto. Argentina no tiene DST,
 * pero esto sobrevive a que manana la zona sea configurable.
 */
function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const firstGuess = new Date(asUtc - offsetMs(new Date(asUtc), timeZone));
  return new Date(asUtc - offsetMs(firstGuess, timeZone));
}

function startOfDay(year: number, month: number, day: number, timeZone: string): Date {
  return zonedWallClockToUtc(year, month, day, 0, 0, 0, 0, timeZone);
}

function endOfDay(year: number, month: number, day: number, timeZone: string): Date {
  return zonedWallClockToUtc(year, month, day, 23, 59, 59, 999, timeZone);
}

function parseDateOnly(raw: string): { year: number; month: number; day: number } | null {
  if (!DATE_ONLY.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Rebota fechas como 2026-02-31, que pasan el chequeo de rango pero no existen.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/**
 * Traduce el filtro de fecha de la URL a un rango de timestamps UTC.
 *
 * Los presets no tienen limite superior a proposito: no hay mensajes en el
 * futuro, y ponerle un techo a "hoy" solo lograria esconder un mensaje que
 * entra mientras la persona mira la pantalla.
 *
 * Un rango personalizado al reves (desde posterior a hasta) se da vuelta en
 * lugar de devolver una lista vacia: es un error de tipeo, no una busqueda.
 */
export function resolveDateRange(
  preset: DatePreset | "",
  fromDate?: string,
  toDate?: string,
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE,
): DateRange {
  if (!preset) return EMPTY_RANGE;

  if (preset === "custom") {
    let start = fromDate ? parseDateOnly(fromDate) : null;
    let end = toDate ? parseDateOnly(toDate) : null;
    if (!start && !end) return EMPTY_RANGE;

    if (start && end) {
      const startMs = Date.UTC(start.year, start.month - 1, start.day);
      const endMs = Date.UTC(end.year, end.month - 1, end.day);
      if (startMs > endMs) [start, end] = [end, start];
    }

    return {
      from: start ? startOfDay(start.year, start.month, start.day, timeZone).toISOString() : null,
      to: end ? endOfDay(end.year, end.month, end.day, timeZone).toISOString() : null,
    };
  }

  const today = civilDate(now, timeZone);
  const days = PRESET_DAYS[preset];
  // Restar sobre el calendario civil: correr el instante UTC hacia atras
  // fallaria justo en el cambio de hora, que es cuando un dia no dura 24 horas.
  const first = new Date(Date.UTC(today.year, today.month - 1, today.day - (days - 1)));

  return {
    from: startOfDay(
      first.getUTCFullYear(),
      first.getUTCMonth() + 1,
      first.getUTCDate(),
      timeZone,
    ).toISOString(),
    to: null,
  };
}

/** El dia de hoy en la zona, en formato YYYY-MM-DD, para el value de un input date. */
export function todayInputValue(now: Date = new Date(), timeZone: string = APP_TIMEZONE): string {
  const { year, month, day } = civilDate(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
