// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Partición de las ventanas libres en horarios (F23, pasos 5 y 6). Adaptado
 * de `packages/features/schedules/lib/slots.ts`: se quitan el modo
 * "optimized slots", los usuarios múltiples y el marcado de "away".
 *
 * Los horarios arrancan alineados a la hora en la zona del anfitrión: con
 * intervalo de 30, un hueco que empieza 10:45 ofrece 11:00, no 10:45. La
 * unidad de alineación es la más grande de 60, 30, 20, 15, 10 y 5 que divide
 * al intervalo (40 se alinea a 20; 45 a 15).
 */
import dayjs from "../time/dayjs";
import type { Slot } from "../types";
import type { Range } from "./date-ranges";

const MIN = 60_000;
const ALIGNMENT_UNITS = [60, 30, 20, 15, 10, 5];

export function alignmentUnit(intervalMinutes: number): number {
  return ALIGNMENT_UNITS.find((u) => intervalMinutes % u === 0) ?? 1;
}

/** El primer instante ≥ `ms` cuyos minutos del día (en la zona) son múltiplo de `unit`. */
export function alignUp(ms: number, tz: string, unit: number): number {
  const floored = ms - (ms % MIN);
  const d = dayjs(floored).tz(tz);
  const minutesOfDay = d.hour() * 60 + d.minute();
  const needsBump = ms > floored ? 1 : 0;
  const aligned = Math.ceil((minutesOfDay + needsBump) / unit) * unit;
  return floored + (aligned - minutesOfDay) * MIN;
}

export interface SplitOptions {
  durationMinutes: number;
  intervalMinutes: number;
  /** Zona del anfitrión, para alinear los horarios a la hora local. */
  tz: string;
}

/**
 * Parte cada ventana en horarios de `duration`, cada `interval` minutos. Un
 * horario entra solo si termina dentro de la ventana.
 */
export function splitIntoSlots(windows: Range[], opts: SplitOptions): Slot[] {
  const duration = Math.max(1, opts.durationMinutes) * MIN;
  const interval = Math.max(1, opts.intervalMinutes) * MIN;
  const unit = alignmentUnit(Math.max(1, opts.intervalMinutes));
  const seen = new Set<number>();
  const slots: Slot[] = [];

  for (const w of [...windows].sort((a, b) => a.start - b.start)) {
    let start = alignUp(w.start, opts.tz, unit);
    while (start + duration <= w.end) {
      if (!seen.has(start)) {
        seen.add(start);
        slots.push({ startUtc: new Date(start).toISOString(), endUtc: new Date(start + duration).toISOString() });
      }
      start += interval;
    }
  }
  return slots;
}
