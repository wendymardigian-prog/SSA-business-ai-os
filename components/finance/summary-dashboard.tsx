import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CategoryBars } from "@/components/finance/category-bars";
import { FinancePeriodControls } from "@/components/finance/finance-period-controls";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { TrendChart } from "@/components/finance/trend-chart";
import type { FinanceDashboardData } from "@/lib/finance/dashboard-load";
import type { CardVariation, SummaryCard } from "@/lib/finance/dashboard-view";
import { formatPct } from "@/lib/finance/dashboard-view";
import { formatUsd } from "@/lib/finance/format";
import { cn } from "@/lib/utils";

/**
 * El Resumen de Finanzas (GF25 a GF28). Solo pinta: todo lo que muestra sale de `loadFinanceDashboard` y de las
 * funciones puras de `lib/finance/dashboard-view.ts`. Server Component; el selector de período y el gráfico son
 * los únicos pedazos de cliente.
 */

const VALUE_TONE: Record<SummaryCard["tone"], string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  neutral: "text-foreground",
};

const VARIATION_TONE = {
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
} as const;

function Variation({ variation }: { variation: CardVariation }) {
  if (variation.kind === "none") return null;
  if (variation.kind === "unavailable") return <p className="mt-1 text-xs text-muted-foreground">{variation.text}</p>;
  const Icon = variation.arrow === "up" ? ArrowUp : variation.arrow === "down" ? ArrowDown : ArrowRight;
  return (
    <p className={cn("mt-1 inline-flex items-center gap-1 text-xs font-medium", VARIATION_TONE[variation.tone])}>
      <Icon className="size-3" aria-hidden />
      {variation.text}
      <span className="font-normal text-muted-foreground">vs. período anterior</span>
    </p>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </section>
  );
}

const TONE_ROW = { red: "text-red-600 dark:text-red-400", amber: "text-amber-700 dark:text-amber-300", neutral: "" } as const;

export function SummaryDashboard({ data }: { data: FinanceDashboardData }) {
  const addHref = "/dashboard/finanzas/gastos";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/finanzas" tabs={<FinanceTabs />} filters={<FinancePeriodControls timezone={data.timeZone} />} />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
        <p className="text-sm text-muted-foreground">
          {data.periodLabel} · zona horaria {data.timeZone}
        </p>

        {data.loadError && (
          <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            No pude leer los números de Finanzas. Probá de nuevo en un rato; si sigue, avisá.
          </p>
        )}
        {data.truncated && (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Este período tiene muchísimos movimientos y las cifras son parciales. Elegí uno más corto para ver todo.
          </p>
        )}

        <section aria-label="Resumen del período" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.cards.map((card) => (
            <div key={card.key} className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums", VALUE_TONE[card.tone])}>{card.value}</p>
              {card.detail && <p className="mt-0.5 text-xs text-muted-foreground">{card.detail}</p>}
              <Variation variation={card.variation} />
            </div>
          ))}
        </section>

        {!data.loadError && !data.hasRevenue && (
          <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
            Todavía no hay pagos cobrados en Ventas en este período, así que los ingresos están en cero.
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Por grupo" hint="Cómo se reparte lo que pagaste">
            <CategoryBars
              emptyMessage="Todavía no hay gastos pagados en este período"
              items={
                data.hasExpenses
                  ? data.groups.map((g) => ({ key: g.key, label: g.label, cents: g.cents, pct: g.pct, color: GROUP_COLORS[g.key], href: g.href, hint: g.hint }))
                  : []
              }
            />
            {!data.hasExpenses && !data.loadError && (
              <Link href={addHref} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                <Plus className="size-3.5" aria-hidden /> Cargar un gasto
              </Link>
            )}
          </Section>

          <Section title="Por categoría" hint="De mayor a menor; tocá una para ver los gastos">
            <CategoryBars
              emptyMessage="Todavía no hay gastos pagados en este período"
              items={data.categories.map((c) => ({ key: c.categoryKey, label: c.name, cents: c.cents, pct: c.pct, color: c.color, href: c.href }))}
            />
          </Section>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Tendencia de 6 meses" hint="Ingresos cobrados, gastos pagados y resultado, por mes">
            <TrendChart trend={data.trend} currentMonth={data.currentMonth} />
          </Section>

          <Section title="Top proveedores" hint="Quiénes se llevaron más del gasto pagado">
            {data.vendors.top.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Todavía no hay gastos pagados con proveedor en este período</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Proveedor</th>
                      <th className="py-1 pr-2 text-right font-medium">Pagos</th>
                      <th className="py-1 pr-2 text-right font-medium">Total</th>
                      <th className="py-1 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vendors.top.map((v) => (
                      <tr key={v.vendorId} className="border-t border-border/60">
                        <td className="max-w-[12rem] truncate py-1.5 pr-2">
                          <Link href={v.href} className="hover:underline">
                            {v.name}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{v.count}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{formatUsd(v.cents)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatPct(v.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.vendors.withoutVendor.count > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Sin proveedor: {data.vendors.withoutVendor.count} {data.vendors.withoutVendor.count === 1 ? "pago" : "pagos"} · {formatUsd(data.vendors.withoutVendor.cents)} ({formatPct(data.vendors.withoutVendor.pct)})
              </p>
            )}
          </Section>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title={data.cac.title} hint="Lo que cuesta conseguir cada venta nueva">
            <p className="text-lg font-semibold tabular-nums">{data.cac.value ?? "—"}</p>
            <p className="text-sm">{data.cac.headline}</p>
            <p className="mt-1 text-xs text-muted-foreground">{data.cac.how}</p>
          </Section>

          <Section title="Por pagar en los próximos 30 días" hint="Por semana, de lunes a domingo">
            {data.upcoming.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No hay pagos programados en los próximos 30 días</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {data.upcoming.map((row) => (
                  <li key={row.key}>
                    <Link href={row.href} className={cn("flex items-baseline justify-between gap-3 py-2 text-sm hover:underline", TONE_ROW[row.tone])}>
                      <span className="min-w-0 truncate font-medium">{row.label}</span>
                      <span className="shrink-0 tabular-nums">
                        {row.countText}
                        {row.amountText ? ` · ${row.amountText}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

const GROUP_COLORS = { adquisicion: "#e11d48", entrega: "#2563eb", operacion: "#16a34a", otro: "#78716c" } as const;
