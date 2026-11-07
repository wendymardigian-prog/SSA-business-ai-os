/**
 * El semáforo de la tabla «Meta vs CRM»: qué número está bien (verde) y cuál está mal (rojo), para verlo de un vistazo.
 *
 * Cada número se compara con el del MEDIO (la mediana) de las filas que se ven en ese momento, con los filtros puestos: así
 * cambia con lo que la persona está mirando («entre mis campañas activas, ¿cuál tiene el CPL más caro?»). La mediana y no el
 * promedio: una campaña con un CPL de 40 no arrastra a las demás.
 *
 * - Verde si es al menos un 20 % mejor que la mediana; rojo si es al menos un 20 % peor; sin color si está cerca.
 * - Solo las métricas de eficiencia (`COLUMN_BETTER`): costos, CTR, ROAS, Lead → Agenda. Los volúmenes (gasto, impresiones,
 *   leads, ventas) dependen del presupuesto: más gasto no es «mejor» ni «peor», y pintarlos confundiría.
 * - Con menos de 3 valores no hay con qué comparar, y una mediana de 0 no deja medir la distancia: sin color.
 * - El Total nunca se pinta (es el resumen, no una fila más).
 *
 * Modulo puro: lo prueba `ads-tone.test.ts`.
 */

import type { ColumnDef, ColumnId } from "./ads-crm-columns";
import type { CrmRow } from "./ads-crm";

export type Better = "higher" | "lower";
export type Tone = "good" | "bad";

/** Qué es mejor en cada métrica de eficiencia. Lo que no está acá no se pinta. */
export const COLUMN_BETTER: Partial<Record<ColumnId, Better>> = {
  // Mayor es mejor: interés, retención y retorno.
  ctr: "higher",
  linkCtr: "higher",
  hookRate: "higher",
  holdRate: "higher",
  retention25: "higher",
  retention50: "higher",
  retention75: "higher",
  retention100: "higher",
  avgWatchSeconds: "higher",
  roasMeta: "higher",
  leadToBooking: "higher",
  roas: "higher", // @plantilla-quitar(ventas)
  roasCash: "higher", // @plantilla-quitar(ventas)
  ufRoas: "higher", // @plantilla-quitar(ventas)
  // Menor es mejor: lo que cuesta cada cosa.
  cpm: "lower",
  cpc: "lower",
  linkCpc: "lower",
  costPerVideo3s: "lower",
  cplMeta: "lower",
  costPerViewContent: "lower",
  costPerApplication: "lower",
  costPerBookingMeta: "lower",
  costPerPurchase: "lower",
  cplNew: "lower",
  cplTotal: "lower",
  costPerBooking: "lower",
  costPerAttended: "lower",
  costPerNewDeal: "lower", // @plantilla-quitar(ventas)
};

/** Cuánto tiene que separarse de la mediana para tener color. */
export const TONE_THRESHOLD = 0.2;
/** Cuántos valores hacen falta para comparar. */
export const TONE_MIN_VALUES = 3;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** La mediana de cada columna con semáforo, sobre las filas que se ven. Sin referencia (null) no se pinta esa columna. */
export function columnReferences(rows: CrmRow[], columns: ColumnDef[]): Partial<Record<ColumnId, number>> {
  const out: Partial<Record<ColumnId, number>> = {};
  for (const column of columns) {
    if (!COLUMN_BETTER[column.id]) continue;
    const values = rows
      .filter((row) => row.objectId !== "total")
      .map((row) => column.value(row))
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (values.length < TONE_MIN_VALUES) continue;
    const ref = median(values);
    if (ref === null || ref === 0) continue;
    out[column.id] = ref;
  }
  return out;
}

export interface CellToneResult {
  tone: Tone;
  /** Cuánto mejor o peor que la mediana, de 0 a 1 (0,34 = 34 %). */
  diff: number;
  reference: number;
}

/** El color de una celda: bueno, malo o ninguno. */
export function cellTone(value: number | null, reference: number | undefined, better: Better | undefined): CellToneResult | null {
  if (value === null || !Number.isFinite(value) || reference === undefined || reference === 0 || !better) return null;
  // Redondeado: 0,8 − 1 da −0,19999… y un 20 % justo se quedaria sin color.
  const change = Math.round(((value - reference) / Math.abs(reference)) * 1e6) / 1e6;
  const gain = better === "higher" ? change : -change;
  if (gain >= TONE_THRESHOLD) return { tone: "good", diff: Math.abs(change), reference };
  if (gain <= -TONE_THRESHOLD) return { tone: "bad", diff: Math.abs(change), reference };
  return null;
}

/** La explicación del color, para el tooltip: «34 % más barato que el medio de lo que ves ($ 0,88)». */
export function toneNote(result: CellToneResult, better: Better, isMoney: boolean, referenceText: string): string {
  const pct = Math.round(result.diff * 100);
  const higherValue = (better === "higher") === (result.tone === "good");
  const word = isMoney ? (higherValue ? "más caro" : "más barato") : higherValue ? "más alto" : "más bajo";
  return `${pct} % ${word} que el medio de lo que ves (${referenceText})`;
}
