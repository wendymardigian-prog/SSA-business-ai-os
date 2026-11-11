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

export interface SalesTotals {
  count: number;
  amount: number | null;
  paid: number | null;
  pending: number | null;
  /** Había más ventas que el tope: el total cuenta solo las primeras. */
  truncated: boolean;
}

interface SaleMoney {
  id: string;
  final_amount: unknown;
}
interface PaymentMoney {
  sale_id: string;
  amount: unknown;
  status: string;
}

/** Cuántas ventas se piden juntas al buscar sus pagos (más largo, la dirección del pedido se pasa del límite). */
export const PAYMENT_CHUNK = 60;

export async function computeSalesTotals(
  fetchSales: (from: number, to: number) => PromiseLike<PageResult<SaleMoney>>,
  fetchPayments: (saleIds: string[], from: number, to: number) => PromiseLike<PageResult<PaymentMoney>>,
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
  for (const sale of sales.rows) {
    const payments = bySale.get(sale.id) ?? [];
    paid.push(salePaid(payments));
    pending.push(saleBalance(sale.final_amount, payments));
  }
  return {
    count: sales.rows.length,
    amount: sumMoney(sales.rows.map((s) => s.final_amount as number | string | null)),
    paid: sumMoney(paid),
    pending: sumMoney(pending),
    truncated: sales.truncated,
  };
}
