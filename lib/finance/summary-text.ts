/**
 * Los textos de los avisos del trabajo diario de Finanzas (puro, en céntimos). Sin montos por proveedor ni
 * conceptos: los avisos y los logs llevan cantidades y ids, no datos de pago.
 */
import { formatUsd } from "./format";

export function summarizeOverdue(rows: ReadonlyArray<{ cents: number }>): { title: string; body: string } | null {
  if (rows.length === 0) return null;
  const cents = rows.reduce((s, r) => s + r.cents, 0);
  const n = rows.length;
  return {
    title: `${n} ${n === 1 ? "gasto venció" : "gastos vencieron"} hoy por ${formatUsd(cents)}`,
    body: "Pasaron su fecha programada sin marcarse como pagados. Revisalos en Finanzas > Gastos.",
  };
}

export function summarizeReviewPending(count: number): { title: string; body: string } | null {
  if (count <= 0) return null;
  return {
    title: `${count} ${count === 1 ? "gasto espera" : "gastos esperan"} que cargues el monto`,
    body: "Son gastos que se repiten y todavía no tienen monto. Cargalos para que se programen.",
  };
}

export function summarizeAutoChanged(input: { concept: string; driftCents: number }): { title: string; body: string } {
  return {
    title: `${input.concept} cambió después de pagado: diferencia ${formatUsd(input.driftCents)}`,
    body: "El gasto pagado no se tocó. Podés crear un ajuste por la diferencia o ignorarla.",
  };
}
