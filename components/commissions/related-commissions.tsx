import Link from "next/link";
import { Users } from "lucide-react";
import { toneClasses } from "@/components/commissions/commission-chips";
import { commissionsHref, emptyCommissionFilters } from "@/lib/commissions/filters";
import { drawerHref } from "@/lib/commissions/list-view";
import { relatedTitle, type RelatedCommissionList } from "@/lib/commissions/related-lists";
import { formatUsd } from "@/lib/finance/format";

/**
 * La sección «Comisiones» que se ve dentro de otra ficha (F62): la de una venta (qué comisiones generó) o la de un
 * gasto de liquidación (qué comisiones paga). No tiene estado ni hace lecturas: recibe la lista ya armada por el
 * servidor (`related-load`), así que se puede dibujar en un Server Component y pasar como una pieza más.
 *
 * Cada línea abre la ficha de esa comisión (`?commission=`) en la pantalla de Comisiones. En el gasto, además,
 * dice de qué venta es cada una (con link si quien mira puede ver ventas).
 */
export function RelatedCommissions({
  list,
  variant,
  canViewSales = false,
  canOpen = true,
  saleId,
}: {
  list: RelatedCommissionList;
  variant: "sale" | "expense";
  canViewSales?: boolean;
  /** Quien mira puede abrir la ficha de cada comisión (`commissions.view`). Sin eso, el título no es un link. */
  canOpen?: boolean;
  /** En la ficha de una venta: para el link «Ver en Comisiones» con la venta filtrada. */
  saleId?: string;
}) {
  const heading = variant === "sale" ? "Comisiones" : "Comisiones de esta liquidación";
  return (
    <section aria-labelledby={`related-commissions-${variant}`} className={variant === "sale" ? "space-y-3" : "rounded-xl border border-border p-4"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`related-commissions-${variant}`} className={`flex items-center gap-2 font-semibold ${variant === "sale" ? "text-base" : "text-sm"}`}>
          <Users className="h-4 w-4" aria-hidden /> {heading}
        </h2>
        {variant === "sale" && saleId && list.items.length > 0 && (
          <Link href={commissionsHref({ saleId })} className="text-xs text-primary underline-offset-2 hover:underline">Ver en Comisiones</Link>
        )}
      </div>

      {list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {variant === "sale"
            ? "Todavía no se generó ninguna comisión. Se generan solas cuando se cobra un pago y hay una regla que lo cubre."
            : "No encontramos las comisiones de este gasto."}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border" aria-label={heading}>
            {list.items.map((item) => (
              <li key={item.id} className={item.voided ? "bg-zinc-500/5 text-muted-foreground" : ""}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    {canOpen ? (
                      <Link href={drawerHref(emptyCommissionFilters(), item.id)} className="block truncate text-sm font-medium underline-offset-2 hover:underline">
                        {relatedTitle(item)}
                        <span className="sr-only"> (abrir la comisión)</span>
                      </Link>
                    ) : (
                      <span className="block truncate text-sm font-medium">{relatedTitle(item)}</span>
                    )}
                    {variant === "expense" && (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.saleId && canViewSales ? (
                          <Link href={`/dashboard/ventas/${item.saleId}`} className="underline-offset-2 hover:underline">{item.contactName ?? "Venta"}</Link>
                        ) : (
                          item.contactName ?? (item.saleId ? "Venta" : "Sin venta")
                        )}
                      </p>
                    )}
                  </div>
                  <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses(item.tone)}`}>
                    {item.statusLabel}
                    {item.statusDetail && item.statusKey !== "pagada" && item.statusKey !== "pendiente" ? <span className="sr-only"> · {item.statusDetail}</span> : null}
                  </span>
                  <span className={`whitespace-nowrap text-sm tabular-nums ${item.amountCents < 0 ? "text-red-600 dark:text-red-400" : ""} ${item.voided ? "line-through" : "font-semibold"}`}>
                    {formatUsd(item.amountCents)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-right text-sm">
            <span className="text-muted-foreground">Total{list.liveCount !== list.items.length ? " sin anuladas" : ""}: </span>
            <strong className="tabular-nums">{formatUsd(list.totalCents)}</strong>
          </p>
        </>
      )}
    </section>
  );
}
