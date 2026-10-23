"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/tooltip";
import { comparePercent, formatCount, formatDuration, type Comparison } from "@/lib/dashboards/chat/comparisons";
import type { CardsBlock } from "@/lib/dashboards/chat/loaders";
import { AWAITING_PARAM } from "@/lib/inbox/awaiting";

/**
 * Las cinco cifras de arriba (F16).
 *
 * Cada numero lleva su contexto: con que se compara, que significa (tooltip) y,
 * en "Esperando respuesta ahora", a donde ir a resolverlo. Un numero sin
 * contexto se mira una vez y no se vuelve a mirar.
 *
 * "Esperando respuesta ahora" no se compara con nada: es el estado de este
 * momento, no del periodo elegido. Desde la 00259 el numero grande es solo lo
 * que TODAVIA se puede responder desde el sistema; lo de ventana vencida va
 * abajo, con su propio link, y lo que no necesita respuesta no cuenta.
 *
 * "Tiempo de respuesta" (00261) reemplaza a "Primera respuesta": promedio de
 * TODAS las esperas del lead que respondio una persona, no solo la primera, y
 * sin el agente en envio directo, las automatizaciones ni las respuestas
 * automaticas de otras herramientas.
 */

const TOOLTIPS = {
  waiting:
    "Conversaciones abiertas donde el último mensaje es del contacto, pasó más de 1 hora y todavía se pueden responder desde el sistema (Instagram deja 24 h desde su último mensaje). No cuenta las que no necesitan respuesta, como un «gracias» o un emoji. No depende del período elegido.",
  received: "Todos los mensajes que entraron en el período, de cualquier canal.",
  sent: "Los mensajes que salieron en el período. Con un filtro puesto, solo los de ese autor.",
  conversations:
    "Conversaciones nuevas del período. Una conversación que se reabre después de días de silencio cuenta como nueva.",
};

function responseTooltip(median: number | null, filtered: boolean): string {
  const base = filtered
    ? "Promedio de lo que tardó el autor elegido en responder, en todos los mensajes del período: desde el primer mensaje del contacto sin responder hasta la respuesta."
    : "Promedio de lo que tardó una persona del equipo en responder, en todos los mensajes del período: desde el primer mensaje del contacto sin responder hasta la respuesta. Cuenta lo que se responde desde el sistema y desde la app de la red. No cuenta al agente cuando envía solo, las automatizaciones ni las respuestas automáticas de otras herramientas (las de menos de 15 segundos). Un borrador aprobado cuenta como respuesta de quien lo aprobó.";
  return median === null ? base : `${base} La mitad se respondió en menos de ${formatDuration(median)}.`;
}

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
        title={authorLabel ? `Tiempo de respuesta de ${authorLabel}` : "Tiempo de respuesta"}
        tooltip={responseTooltip(current.responseMedianSeconds, Boolean(authorLabel))}
        value={formatDuration(current.responseAvgSeconds)}
        // Responder mas rapido es mejor: bajar se pinta de verde.
        comparison={cmp((n) => n.responseAvgSeconds, "less-is-better")}
      />

      <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-warn/40 bg-card p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          Esperando respuesta ahora
          <InfoTooltip text={TOOLTIPS.waiting} label="Qué significa esperando respuesta ahora" />
        </p>
        <p className="text-[26px] font-semibold leading-tight tracking-tight text-warn tabular-nums">{formatCount(waitingNow.canReply)}</p>
        <Link
          href={`/dashboard/inbox?${AWAITING_PARAM}=responder`}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Ver en Inbox
        </Link>
        {waitingNow.windowClosed > 0 && (
          <Link
            href={`/dashboard/inbox?${AWAITING_PARAM}=vencida`}
            className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            title="El contacto escribió hace más de 24 h y nadie le respondió. Desde el sistema ya no se puede: se responde desde la app de la red."
          >
            + {formatCount(waitingNow.windowClosed)} con la ventana vencida
          </Link>
        )}
        {waitingNow.noReplyNeeded > 0 && (
          <p
            className="text-xs text-muted-foreground"
            title="El último mensaje solo cierra la charla (un gracias, un ok, un emoji) o alguien lo marcó así. No cuentan arriba."
          >
            {formatCount(waitingNow.noReplyNeeded)} no necesitan respuesta
          </p>
        )}
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
