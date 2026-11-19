/**
 * Los totales al pie de la tabla de Ventas: Monto, Cobrado y Pendiente de TODAS las ventas del filtro, no solo de la página
 * que se ve. Siempre brutos (el monto de la venta y los pagos cobrados, sin descontar la comisión del procesador).
 *
 * PURO: recibe cómo pedir cada tanda (las ventas del filtro y los pagos de un grupo de ventas), así se prueba sin base. La
 * plata sale de las mismas cuentas que cada fila (`saleBalance`, `salePaid`), en céntimos, y por eso el total es la suma de las filas.
 */
import { fetchAllPages, type PageResult } from "@/lib/shared/paginate";
import { sumMoney } from "@/lib/ui/data-table/totals";
import { saleBalance, salePaid } from "./sale-math";
import { nextPayment } from "./next-payment";
import type { SaleSummary } from "./sort";

export interface SalesTotals {
  count: number;
  amount: number | null;
  paid: number | null;
  pending: number | null;
  /** Había más ventas que el tope: el total cuenta solo las primeras. */
  truncated: boolean;
  /** Cada venta con su plata y su próximo pago: solo con `withSummaries` (para ordenar por lo que sale de los pagos). */
  summaries?: SaleSummary[];
}

interface SaleMoney {
  id: string;
  final_amount: unknown;
  /** Solo hace falta con `withSummaries`. */
  sale_date?: string;
}
interface PaymentMoney {
  sale_id: string;
  amount: unknown;
  status: string;
  /** Solo hacen falta con `withSummaries`. */
  id?: string;
  due_date?: string | null;
}

/** Cuántas ventas se piden juntas al buscar sus pagos (más largo, la dirección del pedido se pasa del límite). */
export const PAYMENT_CHUNK = 60;

export async function computeSalesTotals(
  fetchSales: (from: number, to: number) => PromiseLike<PageResult<SaleMoney>>,
  fetchPayments: (saleIds: string[], from: number, to: number) => PromiseLike<PageResult<PaymentMoney>>,
  options: { withSummaries?: boolean } = {},
): Promise<SalesTotals | null> {
  const sales = await fetchAllPages(fetchSales);
  if (sales.error) return null;

  const chunks: string[][] = [];
  for (let i = 0; i < sales.rows.length; i += PAYMENT_CHUNK) chunks.push(sales.rows.slice(i, i + PAYMENT_CHUNK).map((s) => s.id));
  const results = await Promise.all(chunks.map((ids) => fetchAllPages((from, to) => fetchPayments(ids, from, to))));
  if (results.some((r) => r.error || r.truncated)) return null;

  const bySale = new Map<string, PaymentMoney[]>();
  for (const result of results) for (const p of result.rows) bySale.set(p.sale_id, [...(bySale.get(p.sale_id) ?? []), p]);

  const paid: number[] = [];
  const pending: number[] = [];
  const summaries: SaleSummary[] = [];
  for (const sale of sales.rows) {
    const payments = bySale.get(sale.id) ?? [];
    const salePaidAmount = salePaid(payments);
    const salePending = saleBalance(sale.final_amount, payments);
    paid.push(salePaidAmount);
    pending.push(salePending);
    if (options.withSummaries) {
      summaries.push({
        id: sale.id,
        saleDate: sale.sale_date ?? "",
        amount: Number(sale.final_amount) || 0,
        paid: salePaidAmount,
        pending: salePending,
        nextDue: nextPayment(payments)?.dueDate ?? null,
      });
    }
  }
  return {
    count: sales.rows.length,
    amount: sumMoney(sales.rows.map((s) => s.final_amount as number | string | null)),
    paid: sumMoney(paid),
    pending: sumMoney(pending),
    truncated: sales.truncated,
    ...(options.withSummaries ? { summaries } : {}),
  };
}
