/**
 * Rangos de fecha para los filtros, resueltos en la zona horaria del negocio.
 *
 * Por que no alcanza con `new Date()`: los timestamps se guardan en UTC, y si
 * "hoy" se calcula en UTC, un usuario en Argentina (UTC-3) que filtra a las
 * 21:30 recibe la ventana de manana y no ve ninguno de los mensajes del dia.
 * El corte de dia tiene que hacerse en la zona en la que la persona vive.
 *
 * Todas las funciones reciben la zona por parametro. `workspaces.timezone`
 * existe desde la 00075 y es la que hay que pasarles cuando se sabe de que
 * workspace se trata; las constantes de abajo son el respaldo para los usos
 * que todavia no la tienen a mano.
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
export function civilDate(instant: Date, timeZone: string): { year: number; month: number; day: number } {
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

export function startOfDay(year: number, month: number, day: number, timeZone: string): Date {
  return zonedWallClockToUtc(year, month, day, 0, 0, 0, 0, timeZone);
}

export function endOfDay(year: number, month: number, day: number, timeZone: string): Date {
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

/**
 * Una fecha suelta (la que devuelve un <input type="date">) al instante que se
 * guarda en la base.
 *
 * Se ancla al mediodia de la zona y no a la medianoche. El motivo es concreto:
 * next_followup_date es timestamptz, y "2026-03-15" interpretado como
 * medianoche UTC se muestra como el 14 en Argentina. Con el mediodia, la fecha
 * se lee igual desde cualquier zona que este a menos de 11 horas de la del
 * negocio, que cubre America entera y Europa.
 */
export function dateInputToIso(value: string, timeZone: string = APP_TIMEZONE): string | null {
  if (!DATE_ONLY.test(value)) return null;
  const parts = parseDateOnly(value);
  if (!parts) return null;

  return zonedWallClockToUtc(parts.year, parts.month, parts.day, 12, 0, 0, 0, timeZone).toISOString();
}

/** El instante guardado de vuelta al valor de un <input type="date">. */
export function isoToDateInput(iso: string | null | undefined, timeZone: string = APP_TIMEZONE): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const { year, month, day } = civilDate(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Una fecha para mostrar, sin hora: la hora de un seguimiento no significa nada. */
export function formatDateOnly(iso: string | null | undefined, timeZone: string = APP_TIMEZONE): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * La zona del negocio para los cortes del agente de IA: dia y mes de los topes
 * de gasto, y el horario de atencion. Es la que fija el documento de la Fase 3.
 *
 * OJO: no coincide con APP_TIMEZONE, que es la que usan desde antes los
 * filtros de fecha de la bandeja. Las dos son respaldos: donde se conoce el
 * workspace hay que pasar `workspaces.timezone`. Unificarlas es una decision
 * pendiente, anotada en docs/PENDIENTE.md.
 */
export const BUSINESS_TIMEZONE = "America/Costa_Rica";

/** El instante UTC en que empezo el dia de `now` en la zona. */
export function startOfZonedDay(now: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): Date {
  const { year, month, day } = civilDate(now, timeZone);
  return startOfDay(year, month, day, timeZone);
}

/** El instante UTC en que empezo el mes de `now` en la zona. */
export function startOfZonedMonth(now: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): Date {
  const { year, month } = civilDate(now, timeZone);
  return startOfDay(year, month, 1, timeZone);
}

/**
 * Dia de la semana (0 = domingo) y minutos desde la medianoche en la zona.
 * Lo usa el horario de atencion del agente.
 */
export function zonedClock(
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIMEZONE,
): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24;
  return { weekday, minutes: hour * 60 + Number(get("minute")) };
}

// ── Fecha y hora en la zona del workspace (A19) ────────────────────────────
//
// Un `<input type="datetime-local">` habla en la zona del NAVEGADOR. El
// editor de contenido lo convertia con `new Date(value)`, asi que alguien que
// viaja, o que tiene el sistema en otra zona, programaba a una hora distinta
// de la que veia. La hora de una publicacion es la del negocio, no la de la
// computadora desde la que se carga.

const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** El valor de un <input type="datetime-local"> leido en la zona indicada. */
export function datetimeInputToIso(
  value: string,
  timeZone: string = APP_TIMEZONE,
): string | null {
  const match = DATETIME_LOCAL.exec(value);
  if (!match) return null;

  const [, y, mo, d, h, mi] = match;
  const date = zonedWallClockToUtc(
    Number(y), Number(mo), Number(d), Number(h), Number(mi), 0, 0, timeZone,
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** El instante guardado, escrito para un <input type="datetime-local">. */
export function isoToDatetimeInput(
  iso: string | null | undefined,
  timeZone: string = APP_TIMEZONE,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // `en-CA` con hour12:false devuelve "24" para la medianoche en algunos
  // motores; el input solo acepta 00.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** El nombre corto de la zona, para mostrar al lado del campo (ej: GMT-3). */
export function timeZoneLabel(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(now);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}
