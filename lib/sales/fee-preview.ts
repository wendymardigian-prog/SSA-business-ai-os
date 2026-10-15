/**
 * La vista previa del modal de métodos de pago: "Con un cobro de USD 1.000 el procesador se queda
 * USD 32,30 y entra USD 967,70". Pura: la pantalla solo muestra lo que devuelve.
 */
import { formatUsd } from "@/lib/finance/format";
import { feeBreakdown } from "./fees";

export const PREVIEW_AMOUNT_CENTS = 100_000;

export function feePreviewText(spec: { pct: number; fixed: number }, amountCents = PREVIEW_AMOUNT_CENTS): string {
  const b = feeBreakdown(amountCents / 100, spec);
  if (b.feeTotal <= 0) return `Con un cobro de ${formatUsd(amountCents)} el procesador no se queda nada y entra todo.`;
  return `Con un cobro de ${formatUsd(amountCents)} el procesador se queda ${formatUsd(b.feeTotal)} y entran ${formatUsd(b.net)}.`;
}
