"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/tooltip";
import { comparePercent, formatCount, formatDuration, type Comparison } from "@/lib/dashboards/chat/comparisons";
import type { CardsBlock } from "@/lib/dashboards/chat/loaders";

/**
 * Las cinco cifras de arriba (F16).
 *
 * Cada numero lleva su contexto: con que se compara, que significa (tooltip) y,
 * en "Esperando respuesta ahora", a donde ir a resolverlo. Un numero sin
 * contexto se mira una vez y no se vuelve a mirar.
 *
 * "Esperando respuesta ahora" no se compara con nada: es el estado de este
 * momento, no del periodo elegido.
 */

const TOOLTIPS = {
  first: "Mediana del tiempo entre el primer mensaje del lead y la primera respuesta. Es lo que el lead percibe.",
  waiting:
    "Conversaciones donde el último mensaje es del lead y pasó más de 1 hora sin respuesta. No depende del período elegido.",
  received: "Todos los mensajes que entraron en el período, de cualquier canal.",
  sent: "Los mensajes que salieron en el período. Con un filtro puesto, solo los de ese autor.",
  conversations:
    "Conversaciones nuevas del período. Una conversación que se reabre después de días de silencio cuenta como nueva.",
};

export function KpiCards({
  data,
  authorLabel,
}: {
  data: CardsBlock;
  /** El nombre de lo filtrado, para que la etiqueta de enviados lo diga. */
  authorLabel: string | null;
}) {
  const { current, previous, waitingNow } = data;
  const cmp = (get: (n: typeof current) => number | null, metric: "more-is-better" | "less-is-better" = "more-is-better") =>
    comparePercent(get(current), previous ? get(previous) : null, metric);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Kpi
        title={authorLabel ? "Conversaciones en que participó" : "Conversaciones nuevas"}
        tooltip={TOOLTIPS.conversations}
        value={formatCount(current.newConversations)}
        comparison={cmp((n) => n.newConversations)}
      />
      <Kpi
        title="Mensajes recibidos"
        tooltip={TOOLTIPS.received}
        value={formatCount(current.messagesIn)}
        comparison={cmp((n) => n.messagesIn)}
      />
      <Kpi
        title={authorLabel ? `Mensajes enviados por ${authorLabel}` : "Mensajes enviados"}
        tooltip={TOOLTIPS.sent}
        value={formatCount(current.messagesOut)}
        comparison={cmp((n) => n.messagesOut)}
      />
      <Kpi
        title="Primera respuesta"
        tooltip={TOOLTIPS.first}
        value={formatDuration(current.firstResponseMedianSeconds)}
        // Responder mas rapido es mejor: bajar se pinta de verde.
        comparison={cmp((n) => n.firstResponseMedianSeconds, "less-is-better")}
      />

      <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-warn/40 bg-card p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          Esperando respuesta ahora
          <InfoTooltip text={TOOLTIPS.waiting} label="Qué significa esperando respuesta ahora" />
        </p>
        <p className="text-[26px] font-semibold leading-tight tracking-tight text-warn tabular-nums">{waitingNow}</p>
        <Link href="/dashboard/inbox?estado=abiertas" className="text-xs font-medium text-primary underline-offset-2 hover:underline">
          Ver en Inbox
        </Link>
      </div>
    </div>
  );
}

function Kpi({
  title,
  tooltip,
  value,
  comparison,
}: {
  title: string;
  tooltip: string;
  value: string;
  comparison: Comparison;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="truncate">{title}</span>
        <InfoTooltip text={tooltip} label={`Qué significa ${title}`} />
      </p>
      <p className="text-[26px] font-semibold leading-tight tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">
        {comparison.percent === null ? (
          comparison.label
        ) : (
          <>
            <b className={cn("font-semibold", comparison.tone === "good" ? "text-good" : comparison.tone === "bad" ? "text-bad" : "")}>
              {comparison.label.split(" vs.")[0]}
            </b>{" "}
            vs. período anterior
          </>
        )}
      </p>
    </div>
  );
}
