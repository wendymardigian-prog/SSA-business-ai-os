/**
 * Escala logaritmica para el eje de costo de la dispersion (A4, pestaña
 * Puntos). Una corrida de embeddings y una del agente difieren en tres
 * ordenes de magnitud: una escala lineal dejaria a casi todos los puntos
 * pegados al piso.
 *
 * `niceStep`/`axisTicks` (lib/dashboards/chat/scale.ts) son para una escala
 * LINEAL (pasos de 1/2/5/10 por decada) y no sirven aca: el eje de la
 * dispersion necesita potencias de diez.
 */

export interface LogDomain {
  min: number;
  max: number;
}

function floorPow10(v: number): number {
  return Math.pow(10, Math.floor(Math.log10(v)));
}

function ceilPow10(v: number): number {
  return Math.pow(10, Math.ceil(Math.log10(v)));
}

/** El dominio [min, max] en potencias de diez que cubre los valores positivos. */
export function logDomain(values: number[]): LogDomain {
  const positive = values.filter((v) => v > 0 && Number.isFinite(v));
  if (positive.length === 0) return { min: 0.001, max: 1 };
  const min = floorPow10(Math.min(...positive));
  let max = ceilPow10(Math.max(...positive));
  if (max <= min) max *= 10; // un solo valor: igual se ve una decada de alto.
  return { min, max };
}

/** Las lineas de grilla del eje: una por decada dentro del dominio. */
export function logTicks(domain: LogDomain): number[] {
  const ticks: number[] = [];
  for (let v = domain.min; v <= domain.max * 1.0000001; v *= 10) ticks.push(v);
  return ticks;
}

/** Fraccion 0..1 de abajo hacia arriba. Un valor fuera del dominio se recorta. */
export function logFraction(value: number, domain: LogDomain): number {
  const clamped = Math.min(Math.max(value, domain.min), domain.max);
  return (Math.log10(clamped) - Math.log10(domain.min)) / (Math.log10(domain.max) - Math.log10(domain.min));
}
