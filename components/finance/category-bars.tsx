import Link from "next/link";
import { formatUsd } from "@/lib/finance/format";
import { formatPct } from "@/lib/finance/dashboard-view";

/**
 * Barras horizontales de gasto con el COLOR de cada categoría (el `BarList` de los dashboards no admite color
 * por ítem y no se toca). Cada barra es un link a la lista de gastos que suma. El ancho es relativo al mayor.
 * Sin hooks: sirve tanto en servidor como en cliente.
 */
export interface CategoryBarItem {
  key: string;
  label: string;
  cents: number;
  pct: number;
  color: string;
  href: string;
  hint?: string | null;
}

export function CategoryBars({ items, emptyMessage }: { items: readonly CategoryBarItem[]; emptyMessage: string }) {
  if (items.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  const max = Math.max(1, ...items.map((i) => Math.abs(i.cents)));
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.key}>
          <Link href={item.href} className="group block rounded-lg px-2 py-1.5 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatUsd(item.cents)} · {formatPct(item.pct)}
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-muted" aria-hidden>
              <div className="h-2 rounded-full" style={{ width: `${Math.max(2, Math.round((Math.abs(item.cents) / max) * 100))}%`, backgroundColor: item.color }} />
            </div>
            {item.hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</p>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
