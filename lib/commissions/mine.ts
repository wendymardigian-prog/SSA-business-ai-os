/**
 * «Mis comisiones» (F63). Puro: la línea de arriba de la pantalla de quien solo ve las suyas.
 *
 *   «Este mes: USD 820,00 generados · USD 540,00 pagados»
 *
 *   - Generados = comisiones vivas (no anuladas) con fecha de cobro dentro del mes de hoy.
 *   - Pagados   = las que están en un gasto PAGADO ese mismo mes (la fecha que cuenta es la del pago del gasto,
 *                 no la del cobro: una comisión de septiembre pagada en octubre suma en «pagados» de octubre).
 *
 * Todo en céntimos. Recibe las filas ya clasificadas (`classifyRows`), así el estado sale de la misma fuente que
 * la lista.
 */
import { monthKey, type CivilDate } from "@/lib/finance/dates";
import { formatUsd } from "@/lib/finance/format";
import type { ClassifiedRow } from "./list-model";

export interface MineSummary {
  generatedCents: number;
  paidCents: number;
}

type MineInput = Pick<ClassifiedRow, "commission" | "amountCents" | "status" | "expense">;

export function mineSummary(rows: readonly MineInput[], todayLocal: CivilDate): MineSummary {
  const month = monthKey(todayLocal);
  let generatedCents = 0;
  let paidCents = 0;
  for (const row of rows) {
    if (row.status.key === "anulada") continue;
    if (row.commission.paid_on && monthKey(row.commission.paid_on) === month) generatedCents += row.amountCents;
    if (row.status.key === "pagada" && row.expense?.paid_date && monthKey(row.expense.paid_date) === month) paidCents += row.amountCents;
  }
  return { generatedCents, paidCents };
}

/** «Este mes: USD 820,00 generados · USD 540,00 pagados». */
export function mineSummaryText(summary: MineSummary): string {
  return `Este mes: ${formatUsd(summary.generatedCents)} generados · ${formatUsd(summary.paidCents)} pagados`;
}
