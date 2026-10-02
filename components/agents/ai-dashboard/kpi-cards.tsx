import Link from "next/link";
import { InfoTooltip } from "@/components/ui/tooltip";
import { formatUsd } from "@/components/agents/filters";
import { formatCount } from "@/lib/dashboards/chat/comparisons";
import type { AiKpiCard, AiKpiCards as AiKpiCardsData } from "@/lib/agent/ai-dashboard/kpis";
import { SystemStatusCard, type SystemStatusCardProps } from "./system-status-card";

const TOOLTIPS = {
  today: "El gasto de hoy en todos los proveedores de IA, comparado contra ayer. Es el unico diario: compararlo contra el período entero no diría nada.",
  period: "El gasto de IA del período elegido, en todos los proveedores. Incluye solo corridas con precio cargado.",
  tokens: "Tokens de entrada, salida, caché y embeddings del período, sumados.",
  runs: "Cuantas corridas de IA hubo en el período, cualquiera sea su origen o resultado.",
};

/** Una tarjeta con numero, comparacion y, si hay href, un link a Corridas. */
function Card({
  title,
  tooltip,
  value,
  comparisonLabel,
  comparisonSuffix,
  href,
}: {
  title: string;
  tooltip: string;
  value: string;
  comparisonLabel: string;
  /** "vs. ayer" o "vs. período anterior": "sin comparación"/"sin cambios" no lo llevan. */
  comparisonSuffix: string | null;
  href?: string;
}) {
  const body = (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="truncate">{title}</span>
        <InfoTooltip text={tooltip} label={`Qué significa ${title}`} />
      </p>
      <p className="text-[26px] font-semibold leading-tight tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">
        {comparisonLabel}
        {comparisonSuffix ? ` ${comparisonSuffix}` : ""}
      </p>
    </div>
  );
  if (!href) return body;
  return (
    <Link href={href} className="block transition-opacity hover:opacity-80" aria-label={`${title}: ${value}. Ver en Corridas`}>
      {body}
    </Link>
  );
}

function comparisonParts(card: AiKpiCard, suffix: string): { label: string; suffix: string | null } {
  return { label: card.comparison.label, suffix: card.comparison.percent === null ? null : suffix };
}

export function AiKpiCards({
  cards,
  periodQuery,
  firstAgentId,
  systemStatus,
}: {
  cards: AiKpiCardsData;
  /** `?range=...&from=...&to=...` del período actual, ya serializado (puede ser ""). */
  periodQuery: string;
  firstAgentId: string | null;
  systemStatus: SystemStatusCardProps;
}) {
  const runsHref = `/dashboard/agents/runs${periodQuery ? `?${periodQuery}` : ""}`;
  const todayHref = "/dashboard/agents/runs?range=hoy";
  const today = comparisonParts(cards.today, "vs. ayer");
  const period = comparisonParts(cards.period, "vs. período anterior");
  const runs = comparisonParts(cards.runs, "vs. período anterior");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card title="Gasto de hoy" tooltip={TOOLTIPS.today} value={formatUsd(cards.today.value)} comparisonLabel={today.label} comparisonSuffix={today.suffix} href={todayHref} />
        <Card title="Gasto del período" tooltip={TOOLTIPS.period} value={formatUsd(cards.period.value)} comparisonLabel={period.label} comparisonSuffix={period.suffix} href={runsHref} />
        <Card title="Tokens del período" tooltip={TOOLTIPS.tokens} value={formatCount(cards.tokens.value)} comparisonLabel={cards.tokens.comparison.label} comparisonSuffix={cards.tokens.comparison.percent === null ? null : "vs. período anterior"} />
        <Card title="Corridas del período" tooltip={TOOLTIPS.runs} value={formatCount(cards.runs.value)} comparisonLabel={runs.label} comparisonSuffix={runs.suffix} href={runsHref} />
        <SystemStatusCard {...systemStatus} />
      </div>

      {cards.missingPricing > 0 && (
        <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
          {cards.missingPricing} corrida{cards.missingPricing === 1 ? "" : "s"} sin precio cargado — el gasto real es mayor.
          {firstAgentId && (
            <>
              {" "}
              <Link href={`/dashboard/agents/${firstAgentId}?tab=costs`} className="font-medium underline underline-offset-2">
                Cargar precios
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
