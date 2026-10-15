/**
 * El CSV de comisiones (F67). Los montos van con punto decimal y dos decimales (no el formato de pantalla), para
 * que una planilla los sume. Las fórmulas se neutralizan y lleva BOM (lo hace `lib/csv/write.ts`).
 *
 * Quién ve qué lo decide quien arma las filas, no este archivo: con alcance `own` la RLS ya dejó pasar solo las de
 * la persona, y `cobrado` y `fee` (lo que cobró el negocio) salen vacíos, igual que en la ficha.
 */
import { CSV_BOM, csvCell, type CsvValue } from "@/lib/csv/write";
import { fromCents } from "@/lib/sales/money";

export const COMMISSIONS_CSV_HEADER = [
  "id", "fecha_cobro", "persona", "rol", "contacto", "producto", "financiamiento", "pago_numero", "metodo", "cobrado", "fee", "base", "calculo", "monto", "regla",
  "estado", "gasto_estado", "gasto_fecha", "canal", "pieza_o_anuncio", "notas",
] as const;

export interface CommissionExportRow {
  id: string;
  paidOn: string | null;
  personName: string | null;
  roleName: string | null;
  contactName: string | null;
  productName: string | null;
  /** Ya en palabras («En cuotas»). */
  financing: string | null;
  paymentNumber: number | null;
  method: string | null;
  /** Céntimos; `null` = no se muestra (alcance propio) o no hay. */
  collectedCents: number | null;
  feeCents: number | null;
  baseCents: number | null;
  /** «8 % del neto», «USD 15,00 fijos». */
  calc: string | null;
  amountCents: number;
  ruleName: string | null;
  statusLabel: string;
  expenseStatusLabel: string | null;
  expenseDate: string | null;
  channel: string | null;
  pieceOrAd: string | null;
  notes: string | null;
}

/**
 * Un monto ya formateado. Va aparte del texto a propósito: `csvCell` antepone `'` a todo TEXTO que empieza con `-`
 * (para que una planilla no lo ejecute como fórmula) y un ajuste negativo, `-19.41`, es un número, no una fórmula.
 */
interface Money {
  raw: string;
}
const money = (cents: number | null): Money => ({ raw: cents === null ? "" : fromCents(cents).toFixed(2) });
type Cell = CsvValue | Money;

const cell = (value: Cell): string => (typeof value === "object" && value !== null ? value.raw : csvCell(value));

export function commissionsToCsv(rows: readonly CommissionExportRow[]): string {
  const body: Cell[][] = rows.map((r) => [
    r.id,
    r.paidOn ?? "",
    r.personName ?? "",
    r.roleName ?? "",
    r.contactName ?? "",
    r.productName ?? "",
    r.financing ?? "",
    r.paymentNumber ?? "",
    r.method ?? "",
    money(r.collectedCents),
    money(r.feeCents),
    money(r.baseCents),
    r.calc ?? "",
    money(r.amountCents),
    r.ruleName ?? "",
    r.statusLabel,
    r.expenseStatusLabel ?? "",
    r.expenseDate ?? "",
    r.channel ?? "",
    r.pieceOrAd ?? "",
    r.notes ?? "",
  ]);
  const lines = [COMMISSIONS_CSV_HEADER.map(csvCell).join(","), ...body.map((r) => r.map(cell).join(","))];
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
