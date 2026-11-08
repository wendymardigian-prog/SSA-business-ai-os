import { TrendingDown } from "lucide-react";
import { InfoTooltip, Tip } from "@/components/ui/tooltip";
import { count, money, type AdsTotals } from "@/lib/dashboards/ads";
import {
  FUNNEL_KIND_LABELS,
  formatFunnelDrop,
  formatFunnelPercent,
  funnelNotes,
  funnelSteps,
  type FunnelCrm,
  type FunnelKind,
  type FunnelVizStep,
} from "@/lib/dashboards/ads-funnel";

const SOURCE_LABEL = { meta: "Dato de Meta", crm: "Dato de tu CRM" } as const;

/**
 * El embudo de conversion, segun para que optimiza Meta (`lib/dashboards/ads-funnel.ts`): una campaña de visitas al perfil
 * muestra las visitas al perfil, no los clics salientes. Despues vienen siempre los leads (lo que cuenta Meta al lado de lo
 * que llego al CRM), las agendas y las ventas. Pasar por encima de un paso explica que es, de donde sale y contra que se
 * compara.
 *
 * Cada barra es mas angosta que la anterior. La caida se dibuja solo entre dos pasos que se comparan entre si: los leads del
 * CRM no se calculan contra los de Meta (son dos formas de contar lo mismo). Se pinta con el color de marca, cada paso un
 * poco mas claro.
 */
export function FunnelCard({
  totals,
  actions,
  kind,
  mixed = [],
  currency,
  crm = null,
  crmFailed = false,
}: {
  totals: AdsTotals;
  /** Las acciones del periodo, sumadas (`sumActions`). */
  actions: Record<string, number>;
  kind: FunnelKind;
  /** Los funnels que mezcla una campaña con AdSets de objetivos distintos. */
  mixed?: FunnelKind[];
  currency: string | null;
  crm?: FunnelCrm | null;
  crmFailed?: boolean;
}) {
  const steps = funnelSteps({ kind, totals, actions, crm });
  if (!steps) return null;

  const widths = steps.map((_, i) => Math.max(100 - i * (100 / steps.length) * 0.4, 20));
  const hasSales = (totals.purchaseValue ?? 0) > 0 && totals.roas !== null;
  const notes = funnelNotes({ kind, mixed, steps, crm, crmFailed });
  const labelOf = (key: FunnelVizStep["key"] | null) => steps.find((s) => s.key === key)?.label ?? "";

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label="Funnel de conversión">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TrendingDown className="h-4 w-4 text-primary-ink" aria-hidden /> Funnel de conversión
        {kind !== "generic" && <span className="font-normal text-muted-foreground">· {FUNNEL_KIND_LABELS[kind]}</span>}
        <InfoTooltip
          label="Qué muestra el funnel"
          text="Los pasos de Meta cambian según para qué optimiza la campaña: visitas al perfil, tráfico, mensajes, leads… Después vienen siempre los leads (lo que cuenta Meta al lado de lo que llegó a tu CRM), las agendas y las ventas, y desde los leads los porcentajes salen de tu CRM. Pasá por encima de cada paso para ver qué es." // @plantilla-quitar(ventas)
          // @plantilla-sin(ventas): text="Los pasos de Meta cambian según para qué optimiza la campaña: visitas al perfil, tráfico, mensajes, leads… Después vienen siempre los leads (lo que cuenta Meta al lado de lo que llegó a tu CRM) y las agendas, y desde los leads los porcentajes salen de tu CRM. Pasá por encima de cada paso para ver qué es."
        />
      </h3>
      <div className="space-y-1">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          // La caida solo entre dos pasos que se comparan entre si.
          const showsDrop = next && next.base === step.key && next.percent !== null && next.percent <= 100;
          // Leads Meta y Leads CRM (y Compras Meta y Ventas) son el mismo paso contado por dos fuentes.
          const sameStep = next && !showsDrop && next.source === "crm" && step.source === "meta" && i > 0;
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
                    {step.base && step.percent !== null && (
                      <span className="mt-1 block text-muted-foreground">
                        Es el {formatFunnelPercent(step.percent)} de {labelOf(step.base)}.
                      </span>
                    )}
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
                  {i === 0 ? "100%" : step.percent === null ? "—" : formatFunnelPercent(step.percent)}
                </span>
              </Tip>
              {showsDrop && (
                <div className="flex w-full items-center gap-3 py-0.5">
                  <div className="w-20 sm:w-24" />
                  <div className="flex flex-1 justify-center">
                    <span className="text-xs text-muted-foreground">↓ {formatFunnelDrop(next.percent as number)} drop-off</span>
                  </div>
                  <div className="w-14" />
                </div>
              )}
              {sameStep && (
                <div className="flex w-full items-center gap-3 py-0.5">
                  <div className="w-20 sm:w-24" />
                  <div className="flex flex-1 justify-center">
                    <span className="text-xs text-muted-foreground">↕ el mismo paso, contado por tu CRM</span>
                  </div>
                  <div className="w-14" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
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
