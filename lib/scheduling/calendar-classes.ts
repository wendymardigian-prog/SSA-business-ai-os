/**
 * La capa «Clases» del calendario de la Agenda: las clases en vivo de los programas (Portal → Calendario) que da cada
 * persona como anfitriona, con el color de la marca. PURO: el componente solo lo compone.
 *
 * - Solo de lectura: una clase se mueve o se cancela desde el Portal, no se arrastra acá.
 * - Una fecha cancelada no viaja; una movida viaja con su horario nuevo (`startAt` real).
 * - Se agrupa por el día de quien mira (una clase a medianoche cae en el día que le toca a esa persona).
 *
 * Lo genérico vive acá (sin el módulo de Servicios no llega ninguna clase y la capa no se dibuja); lo que lee la base
 * es `lib/program/agenda-classes.ts`, que se poda con el módulo.
 */
import { dateInTz, minutesOfDayInTz } from "@/lib/scheduling/time/tz";

export interface AgendaClass {
  /** `<sesión>|<fecha original>`: único por clase. */
  key: string;
  sessionId: string;
  occursOn: string;
  title: string;
  /** El programa al que pertenece. */
  productTitle: string | null;
  hostUserId: string;
  startAt: string;
  endAt: string;
  meetingUrl: string | null;
  moved: boolean;
}

export interface ClassPlaced {
  key: string;
  cls: AgendaClass;
  startMinutes: number;
  endMinutes: number;
}

/** El interruptor en la URL: prendido salvo `clases=0`. */
export function parseClassesLayer(value: string | string[] | null | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== "0";
}

export function classesLayerParam(on: boolean): string | null {
  return on ? null : "0";
}

/** Las clases por día (en la zona de quien mira), dentro del rango que se ve, ordenadas por hora. */
export function placeClassesInCalendar(input: { classes: readonly AgendaClass[]; viewerTz: string; range: { from: string; to: string } }): Record<string, ClassPlaced[]> {
  const out: Record<string, ClassPlaced[]> = {};
  for (const cls of input.classes) {
    const date = dateInTz(cls.startAt, input.viewerTz);
    if (date < input.range.from || date > input.range.to) continue;
    const startMinutes = minutesOfDayInTz(cls.startAt, input.viewerTz);
    const durationMinutes = Math.max(5, Math.round((Date.parse(cls.endAt) - Date.parse(cls.startAt)) / 60_000));
    (out[date] ??= []).push({ key: `l:${cls.key}`, cls, startMinutes, endMinutes: startMinutes + durationMinutes });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.startMinutes - b.startMinutes);
  return out;
}

/** ¿Va en esta columna? Sin vista de equipo, todas; en la de equipo, solo en la de su anfitrión. */
export function classInColumn(cls: Pick<AgendaClass, "hostUserId">, columnUserId: string | null): boolean {
  return !columnUserId || cls.hostUserId === columnUserId;
}
