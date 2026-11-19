"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { placeTooltip, type TooltipPlacement } from "@/lib/ui/tooltip-position";
import { formatMoney } from "@/lib/shared/format";
import { PAYMENT_STATUS_LABELS } from "@/lib/sales/labels";
import type { OpenPayment } from "@/lib/sales/next-payment";

const WIDTH = 280;
/** Alto aproximado (solo decide si el panel va arriba o abajo). */
const heightGuess = (rows: number) => 56 + Math.max(1, rows) * 24;

/**
 * El monto de «Pendiente» con su detalle: al pasar el mouse (o con el foco del teclado) muestra todos los pagos morosos y
 * programados de la venta, por fecha y con su monto. El panel va con `position: fixed` (la celda de la tabla recorta lo que
 * se sale) y se ubica con `placeTooltip`. Se cierra con Esc, al salir y al desplazar.
 */
export function PendingBreakdown({ amount, payments, formatDate }: { amount: number; payments: OpenPayment[]; formatDate: (date: string) => string }) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPlacement(
      placeTooltip({
        anchor: { left: rect.right - WIDTH, top: rect.top, bottom: rect.bottom },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        width: WIDTH,
        height: heightGuess(payments.length),
      }),
    );
  }, [payments.length]);
  const hide = useCallback(() => setPlacement(null), []);

  useEffect(() => {
    if (!placement) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [placement, hide]);

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
    <>
      <button
        ref={ref}
        type="button"
        aria-describedby={placement ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="cursor-help rounded tabular-nums underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {formatMoney(amount)}
      </button>
      {placement && (
        <div
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-50 whitespace-normal rounded-lg border border-border bg-popover p-3 text-left text-xs text-popover-foreground shadow-lg"
          style={{ left: placement.left, top: placement.top, width: placement.width, transform: placement.above ? "translateY(-100%)" : undefined }}
        >
          <p className="mb-1.5 font-medium">Pagos por cobrar</p>
          {body}
        </div>
      )}
    </>
  );
}
