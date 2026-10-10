import { TrendingDown } from "lucide-react";
import { count, money, type AdsTotals } from "@/lib/dashboards/ads";
import { funnelSteps } from "@/lib/dashboards/ads-view";

/**
 * El embudo de conversion: impresiones, clics, leads y, si hubo, compras.
 *
 * Cada barra es mas angosta que la anterior y dice que porcentaje del paso
 * previo llego; entre una y otra, cuanto se cayo. Se pinta con el color de
 * marca (cada paso, un poco mas claro) y no con un violeta fijo.
 *
 * Sin leads ni compras no hay embudo que dibujar: la tarjeta no aparece.
 */
export function FunnelCard({ totals, currency }: { totals: AdsTotals; currency: string | null }) {
  const steps = funnelSteps(totals);
  if (!steps) return null;

  const widths = steps.map((_, i) => Math.max(100 - i * (100 / steps.length) * 0.4, 20));
  const hasSales = (totals.purchaseValue ?? 0) > 0 && totals.roas !== null;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label="Funnel de conversión">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TrendingDown className="h-4 w-4 text-primary" aria-hidden /> Funnel de conversión
      </h3>
      <div className="space-y-1">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          return (
            <div key={step.label} className="flex flex-col items-center gap-0.5">
              <div className="flex w-full items-center gap-3">
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground sm:w-24">{step.label}</span>
                <div className="flex flex-1 justify-center">
                  <div
                    className="flex h-8 items-center justify-center rounded bg-primary transition-all"
                    style={{ width: `${widths[i]}%`, opacity: 1 - i * 0.16 }}
                  >
                    <span className="text-xs font-medium text-primary-foreground">{count(step.value)}</span>
                  </div>
                </div>
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  {i === 0 ? "100%" : step.percent === null ? "—" : `${step.percent.toFixed(1)}%`}
                </span>
              </div>
              {next && next.percent !== null && (
                <div className="flex w-full items-center gap-3 py-0.5">
                  <div className="w-20 sm:w-24" />
                  <div className="flex flex-1 justify-center">
                    <span className="text-xs text-muted-foreground">↓ {(100 - next.percent).toFixed(1)}% drop-off</span>
                  </div>
                  <div className="w-14" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {hasSales && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">ROAS total</span>
          <div className="text-right">
            <span className="text-sm font-bold text-emerald-500">{totals.roas?.toFixed(2)}x</span>
            <span className="ml-2 text-xs text-muted-foreground">
              ({money(totals.purchaseValue, currency, { narrow: true })} en ventas)
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
