/**
 * La lógica del control de número con − y + (E2). Puro: el componente
 * (`components/eod/number-stepper.tsx`) solo la compone.
 */
export interface StepperBounds {
  min?: number;
  max?: number;
  /** Entero ≥ 1. Por defecto 1. */
  step?: number;
}

function stepOf(bounds: StepperBounds): number {
  const step = bounds.step;
  return typeof step === "number" && Number.isInteger(step) && step >= 1 ? step : 1;
}

/** Deja el valor dentro de [min, max]. */
export function clamp(value: number, bounds: StepperBounds): number {
  let out = value;
  if (bounds.min !== undefined && out < bounds.min) out = bounds.min;
  if (bounds.max !== undefined && out > bounds.max) out = bounds.max;
  return out;
}

/** El valor desde el que se cuenta cuando el campo está vacío: el mínimo, o 0. */
function baseOf(value: number | null | undefined, bounds: StepperBounds): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return bounds.min ?? 0;
}

export function canIncrement(value: number | null | undefined, bounds: StepperBounds): boolean {
  if (value === null || value === undefined) return bounds.max === undefined || (bounds.min ?? 0) <= bounds.max;
  return bounds.max === undefined || value < bounds.max;
}

export function canDecrement(value: number | null | undefined, bounds: StepperBounds): boolean {
  if (value === null || value === undefined) return false;
  return bounds.min === undefined || value > bounds.min;
}

/**
 * Suma un paso. Con el campo vacío, el primer "+" cuenta el primero: desde 0 lleva a 1, y
 * con un mínimo mayor que 0 (una calificación de 1 a 10) lleva al mínimo. En el máximo, no
 * cambia nada.
 */
export function increment(value: number | null | undefined, bounds: StepperBounds): number | null {
  if (!canIncrement(value, bounds)) return value ?? null;
  if ((value === null || value === undefined) && bounds.min !== undefined && bounds.min > 0) return clamp(bounds.min, bounds);
  return clamp(baseOf(value, bounds) + stepOf(bounds), bounds);
}

/** Resta un paso. En el mínimo (o vacío), no cambia nada. */
export function decrement(value: number | null | undefined, bounds: StepperBounds): number | null {
  if (!canDecrement(value, bounds)) return value ?? null;
  return clamp((value as number) - stepOf(bounds), bounds);
}

export type ParsedTyped =
  | { kind: "empty" }
  | { kind: "value"; value: number }
  | { kind: "invalid"; reason: string };

/**
 * Lo que se escribió a mano. "abc" no es un número y NO cambia el valor; un número
 * fuera de rango se marca como error y no se guarda hasta corregirlo.
 */
export function parseTyped(text: string, bounds: StepperBounds): ParsedTyped {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  if (!/^-?\d+$/.test(trimmed)) return { kind: "invalid", reason: "Escribí un número entero" };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { kind: "invalid", reason: "Escribí un número entero" };
  if (bounds.min !== undefined && value < bounds.min) return { kind: "invalid", reason: `El mínimo es ${bounds.min}` };
  if (bounds.max !== undefined && value > bounds.max) return { kind: "invalid", reason: `El máximo es ${bounds.max}` };
  const step = stepOf(bounds);
  if (step > 1 && (value - (bounds.min ?? 0)) % step !== 0) {
    return { kind: "invalid", reason: `Tiene que ir de ${step} en ${step}` };
  }
  return { kind: "value", value };
}

/** Los tiempos de "mantener apretado": empieza a repetir a los 400 ms, cada 80 ms. */
export const HOLD_DELAY_MS = 400;
export const HOLD_INTERVAL_MS = 80;
