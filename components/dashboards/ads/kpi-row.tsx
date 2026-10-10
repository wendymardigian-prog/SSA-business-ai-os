import type { KpiDelta } from "@/lib/dashboards/ads-view";

/**
 * La fila de ocho cifras en una sola tarjeta.
 *
 * Ocho columnas en escritorio y cuatro (dos filas) en tablet y celular. Las
 * separaciones son un borde izquierdo por cifra, no un `divide-x`: con dos
 * filas, `divide-x` pintaria una raya al borde izquierdo de la segunda.
 */

export interface KpiItem {
  key: string;
  label: string;
  value: string;
  /** La linea de abajo ("CTR: 3,2%", "por clic"). */
  sub: string;
  /** Contra el periodo anterior. Null si no hay con que comparar. */
  delta: KpiDelta | null;
}

const DELTA_TONE = {
  good: "text-emerald-500",
  bad: "text-red-500",
  neutral: "text-muted-foreground",
} as const;

export function KpiRow({ items }: { items: KpiItem[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="grid grid-cols-4 gap-y-3 lg:grid-cols-8">
        {items.map((item) => (
          <div
            key={item.key}
            className="min-w-0 border-l border-border/60 px-2 first:border-l-0 first:pl-0 sm:px-3 [&:nth-child(4n+1)]:border-l-0 [&:nth-child(4n+1)]:pl-0 lg:[&:nth-child(4n+1)]:border-l lg:[&:nth-child(4n+1)]:pl-3 lg:first:border-l-0 lg:first:pl-0"
          >
            <p className="mb-1.5 truncate text-[9px] font-medium uppercase leading-none tracking-normal text-muted-foreground sm:text-[10px] sm:tracking-wider">
              {item.label}
            </p>
            <p className="truncate text-base font-bold leading-none text-foreground sm:text-xl" title={item.value}>
              {item.value}
            </p>
            <div className="mt-1.5 flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-1">
              <p className="max-w-full truncate text-[10px] text-muted-foreground" title={item.sub}>
                {item.sub}
              </p>
              {item.delta && (
                <span className={`shrink-0 text-[10px] font-medium ${DELTA_TONE[item.delta.tone]}`}>
                  {item.delta.percent >= 0 ? "▲" : "▼"}
                  {Math.abs(item.delta.percent).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
