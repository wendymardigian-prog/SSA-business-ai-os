"use client";

import type { ReactNode } from "react";
import { Tip } from "@/components/ui/tooltip";
import { formatMoney } from "@/lib/shared/format";
import { PAYMENT_STATUS_LABELS } from "@/lib/sales/labels";
import type { OpenPayment } from "@/lib/sales/next-payment";

/**
 * El monto de «Pendiente» con su detalle: al pasar el mouse (o con el foco del teclado) muestra todos los pagos morosos y
 * programados de la venta, por fecha y con su monto. Usa el tooltip del sistema (`Tip`): instantaneo, fuera de la celda
 * (no lo recorta la tabla) y siempre dentro de la pantalla.
 */
export function PendingBreakdown({ amount, payments, formatDate }: { amount: number; payments: OpenPayment[]; formatDate: (date: string) => string }) {
  let body: ReactNode;
  if (payments.length === 0) {
    body = <p className="text-muted-foreground">No hay pagos programados para este saldo.</p>;
  } else {
    body = (
      <ul className="space-y-1">
        {payments.map((p, i) => (
          <li key={p.id ?? i} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">
              <span className={p.overdue ? "font-medium text-red-700 dark:text-red-400" : ""}>{p.dueDate ? formatDate(p.dueDate) : "Sin fecha"}</span>
              <span className={`ml-1.5 text-[11px] ${p.overdue ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>{PAYMENT_STATUS_LABELS[p.overdue ? "overdue" : "scheduled"]}</span>
            </span>
            <span className="shrink-0 tabular-nums">{formatMoney(p.amount)}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Tip
      asChild
      side="bottom"
      align="start"
      panelClassName="w-[280px] max-w-[calc(100vw-1rem)] whitespace-normal p-3"
      content={
        <>
          <p className="mb-1.5 font-medium">Pagos por cobrar</p>
          {body}
        </>
      }
    >
      <button
        type="button"
        className="cursor-help rounded tabular-nums underline decoration-dotted decoration-disabled-foreground/60 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {formatMoney(amount)}
      </button>
    </Tip>
  );
}
