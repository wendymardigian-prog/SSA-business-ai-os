import { TrendingDown } from "lucide-react";
import { InfoTooltip, Tip } from "@/components/ui/tooltip";
import { count, money, type AdsTotals } from "@/lib/dashboards/ads";
import { funnelNote, funnelSteps, type FunnelCrm } from "@/lib/dashboards/ads-view";

const SOURCE_LABEL = { meta: "Dato de Meta", crm: "Dato de tu CRM" } as const;

/**
 * El embudo de conversion: lo que cuenta Meta (impresiones, clics, leads y, si hubo, compras) y lo que paso en el CRM (leads,
 * agendas y ventas atribuidas, si hubo). Pasar por encima de un paso explica que es y de donde sale.
 *
 * Cada barra es mas angosta que la anterior y dice que porcentaje del paso previo llego; entre una y otra, cuanto se cayo. Un
 * paso que no se compara con el anterior (los leads de Meta y los del CRM cuentan lo mismo de dos formas) no lleva caida. Se
 * pinta con el color de marca (cada paso, un poco mas claro) y no con un violeta fijo.
 *
 * Sin leads ni compras en ninguna de las dos fuentes no hay embudo que dibujar: la tarjeta no aparece.
 */
export function FunnelCard({ totals, currency, crm = null, crmFailed = false }: { totals: AdsTotals; currency: string | null; crm?: FunnelCrm | null; crmFailed?: boolean }) {
  const steps = funnelSteps(totals, crm);
  if (!steps) return null;

  const widths = steps.map((_, i) => Math.max(100 - i * (100 / steps.length) * 0.4, 20));
  const hasSales = (totals.purchaseValue ?? 0) > 0 && totals.roas !== null;
  const note = funnelNote(crm, crmFailed);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label="Funnel de conversión">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TrendingDown className="h-4 w-4 text-primary-ink" aria-hidden /> Funnel de conversión
        <InfoTooltip
          label="Qué muestra el funnel"
          text="Cada paso cuenta lo que pasó en el período elegido. Hasta los leads de Meta, los números son de Meta. Leads CRM, Agendas y Ventas salen de tu CRM y solo cuentan lo que se atribuye a esto. Pasá por encima de cada paso para ver qué es." // @plantilla-quitar(ventas)
          // @plantilla-sin(ventas): text="Cada paso cuenta lo que pasó en el período elegido. Hasta los leads de Meta, los números son de Meta. Leads CRM y Agendas salen de tu CRM y solo cuentan lo que se atribuye a esto. Pasá por encima de cada paso para ver qué es."
        />
      </h3>
      <div className="space-y-1">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const showsDrop = next && next.percent !== null && next.percent <= 100;
          return (
            <div key={step.key} className="flex flex-col items-center gap-0.5">
              <Tip
                className="flex w-full items-center gap-3"
                content={
                  <>
                    <span className="mb-1 block font-semibold">
                      {step.label} · {SOURCE_LABEL[step.source]}
                    </span>
                    <span className="block text-muted-foreground">{step.tip}</span>
                  </>
                }
              >
                <span tabIndex={0} className="w-20 shrink-0 cursor-help text-right text-xs text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-24">
                  {step.label}
                </span>
                <div className="flex flex-1 justify-center">
                  <div
                    className="flex h-8 items-center justify-center rounded bg-primary transition-all"
                    style={{ width: `${widths[i]}%`, opacity: 1 - i * 0.12 }}
                  >
                    <span className="text-xs font-medium text-primary-foreground">{count(step.value)}</span>
                  </div>
                </div>
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  {i === 0 ? "100%" : step.percent === null ? "—" : `${step.percent.toFixed(1)}%`}
                </span>
              </Tip>
              {showsDrop && (
                <div className="flex w-full items-center gap-3 py-0.5">
                  <div className="w-20 sm:w-24" />
                  <div className="flex flex-1 justify-center">
                    <span className="text-xs text-muted-foreground">↓ {(100 - (next.percent as number)).toFixed(1)}% drop-off</span>
                  </div>
                  <div className="w-14" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {hasSales && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">ROAS total</span>
          <div className="text-right">
            <span className="text-sm font-bold text-emerald-500">{totals.roas?.toFixed(2)}x</span>
            <span className="ml-2 text-xs text-muted-foreground">
              ({money(totals.purchaseValue, currency, { narrow: true })} en ventas) {/* @plantilla-quitar(ventas) */}
              {/* @plantilla-sin(ventas): ({money(totals.purchaseValue, currency, { narrow: true })} en compras) */}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
