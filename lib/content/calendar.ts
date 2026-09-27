/**
 * El calendario de contenido (F21).
 *
 * La regla que define todo: **una tarjeta por PIEZA por DIA**. La misma pieza
 * saliendo en tres redes el mismo dia es una tarjeta con tres iconos, no tres
 * tarjetas. Si una red sale otro dia, ese dia hay otra tarjeta de la misma
 * pieza, marcada como redistribucion.
 *
 * Esa distincion es lo que hace util al calendario: "que publico esta semana"
 * se responde mirando piezas, y "cuanto trabajo hay" mirando publicaciones.
 * Por eso el selector "Contar: Piezas / Publicaciones" y por eso el resumen
 * del mes dice las tres cosas.
 *
 * Todo puro, con la zona horaria como parametro: los cortes de dia dependen
 * de la zona del negocio y no de la del navegador.
 */

import type { SocialPostStatus } from "@/lib/types/database";

export interface CalendarNetwork {
  platform: string;
  /** Fecha real (programada o publicada) o tentativa. */
  at: string;
  /** null = todavia tentativa: no hay nada agendado. */
  status: SocialPostStatus | null;
}

export interface CalendarPiece {
  id: string;
  title: string;
  format: string | null;
  networks: CalendarNetwork[];
  /** Una publicacion hecha a mano fuera del sistema. */
  external?: boolean;
}

export interface CalendarCard {
  pieceId: string;
  title: string;
  format: string | null;
  /** El dia, en la zona del workspace: "2026-10-01". */
  day: string;
  networks: CalendarNetwork[];
  /** Es una salida posterior a la primera de la pieza. */
  redistribution: boolean;
  /** Ninguna de sus redes esta agendada todavia. */
  tentative: boolean;
  /**
   * Como se ve la tarjeta (C14). Antes solo se distinguia "tentativa" de "el
   * resto": una que fallo se veia igual que una publicada, asi que el
   * calendario no servia para lo que uno va a buscar ahi, que es si algo
   * salio.
   */
  tone: "tentative" | "scheduled" | "published" | "failed" | "mixed";
  /** La hora de la primera salida del dia, en la zona del workspace. */
  time: string;
}

/** El dia de una fecha, en la zona que se le pase. */
export function dayIn(iso: string, timeZone: string): string {
  // en-CA da ISO (2026-10-01), que es lo que se quiere para comparar y ordenar.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Las tarjetas de un conjunto de piezas.
 *
 * Una pieza se parte en tantas tarjetas como DIAS distintos tengan sus redes.
 * La primera (la del dia mas temprano) es la publicacion; las siguientes son
 * redistribuciones, y asi es como se cuentan.
 */
export function buildCalendar(pieces: CalendarPiece[], timeZone: string): CalendarCard[] {
  const cards: CalendarCard[] = [];

  for (const piece of pieces) {
    const withDay = piece.networks
      .filter((n) => n.at)
      .map((n) => ({ ...n, day: dayIn(n.at, timeZone) }));

    if (withDay.length === 0) continue;

    const byDay = new Map<string, CalendarNetwork[]>();
    for (const network of withDay) {
      const list = byDay.get(network.day) ?? [];
      list.push({ platform: network.platform, at: network.at, status: network.status });
      byDay.set(network.day, list);
    }

    const days = [...byDay.keys()].sort();
    for (const [index, day] of days.entries()) {
      const networks = byDay.get(day)!;
      cards.push({
        pieceId: piece.id,
        title: piece.title,
        format: piece.format,
        day,
        networks,
        // Toda fecha posterior a la primera de la pieza es redistribucion.
        redistribution: index > 0,
        tentative: networks.every((n) => n.status === null),
        tone: toneOf(networks),
        time: timeIn(
          networks.map((n) => n.at).sort()[0],
          timeZone,
        ),
      });
    }
  }

  return cards.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
}

/**
 * De que color va la tarjeta.
 *
 * Un fallo gana sobre todo lo demas: es lo unico que pide que alguien haga
 * algo hoy.
 */
export function toneOf(networks: CalendarNetwork[]): CalendarCard["tone"] {
  const estados = new Set(networks.map((n) => n.status));
  if (estados.has("failed")) return "failed";
  if ([...estados].every((s) => s === null)) return "tentative";
  if ([...estados].every((s) => s === "published")) return "published";
  if ([...estados].every((s) => s === "scheduled" || s === "uploading" || s === "publishing")) {
    return "scheduled";
  }
  return "mixed";
}

/** La hora, en la zona del workspace: "15:00". */
export function timeIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export type CountMode = "pieces" | "publications";

export interface MonthSummary {
  /** Piezas nuevas: cada pieza se cuenta una vez, en su primera fecha. */
  pieces: number;
  /** Publicaciones: cada red cuenta. */
  publications: number;
  /** Salidas posteriores a la primera de su pieza. */
  redistributions: number;
}

/**
 * El resumen del mes.
 *
 * Una pieza cuenta como "nueva" solo si su PRIMERA fecha cae en el mes: una
 * pieza de septiembre redistribuida en octubre no es contenido nuevo de
 * octubre, y contarla asi infla el numero que sirve para decidir si se esta
 * produciendo lo suficiente.
 */
export function summarize(cards: CalendarCard[], month: string): MonthSummary {
  const inMonth = cards.filter((c) => c.day.startsWith(month));

  return {
    pieces: inMonth.filter((c) => !c.redistribution).length,
    publications: inMonth.reduce((total, card) => total + card.networks.length, 0),
    redistributions: inMonth.filter((c) => c.redistribution).length,
  };
}

/** Cuanto "pesa" una tarjeta segun lo que se este contando. */
export function cardCount(card: CalendarCard, mode: CountMode): number {
  return mode === "pieces" ? (card.redistribution ? 0 : 1) : card.networks.length;
}

export type RescheduleResult = { ok: true; at: string } | { ok: false; error: string };

/** Margen minimo para reprogramar: menos que esto no llega a la cola. */
export const MIN_SCHEDULE_LEAD_MINUTES = 5;

/**
 * Mover una publicacion a otro dia.
 *
 * Conserva la HORA y cambia solo el dia: arrastrar una tarjeta en el
 * calendario dice "este otro dia", no "a las 00:00".
 */
export function reschedule(params: {
  currentAt: string;
  toDay: string;
  timeZone: string;
  now?: Date;
}): RescheduleResult {
  const now = params.now ?? new Date();
  const current = new Date(params.currentAt);
  if (Number.isNaN(current.getTime())) {
    return { ok: false, error: "La fecha actual no es valida" };
  }

  // La hora del dia se conserva tal cual: se reemplaza solo la parte de fecha
  // de su representacion en la zona del workspace.
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: params.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(current);

  const candidate = zonedToUtc(`${params.toDay}T${time}:00`, params.timeZone);
  if (!candidate) return { ok: false, error: "No pude entender esa fecha" };

  const minutesAhead = (candidate.getTime() - now.getTime()) / 60000;
  if (minutesAhead < MIN_SCHEDULE_LEAD_MINUTES) {
    return {
      ok: false,
      error:
        minutesAhead < 0
          ? "No se puede programar en el pasado"
          : `Falta muy poco: tiene que ser al menos ${MIN_SCHEDULE_LEAD_MINUTES} minutos despues de ahora`,
    };
  }

  return { ok: true, at: candidate.toISOString() };
}

/**
 * Una fecha y hora "de pared" en una zona, pasada a UTC.
 *
 * Se calcula el desfase real de esa zona EN ESA FECHA en vez de usar uno fijo:
 * con horario de verano, un desfase fijo corre las publicaciones una hora
 * durante medio año.
 */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, y, m, d, hh, mm] = match.map(Number) as unknown as number[];
  // Se trata lo local como si fuera UTC y se corrige por el desfase de la
  // zona. Dos pasadas: la primera usa el desfase en la marca equivocada, y
  // eso falla justo en el fin de semana del cambio de hora. La segunda lo
  // recalcula sobre la marca ya corregida.
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetOf(guess, timeZone);
  return new Date(guess - offsetOf(first, timeZone));
}

function offsetOf(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMillis));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - utcMillis;
}
