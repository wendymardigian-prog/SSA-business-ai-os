"use client";

import Link from "next/link";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/tooltip";
import { EmptyBlock, Panel } from "./block";
import { Sparkline } from "./sparkline";
import { comparePoints, formatCount, formatDuration } from "@/lib/dashboards/chat/comparisons";
import { DIRECT_SEND_REFERENCE_PCT, type DraftsCard } from "@/lib/dashboards/chat/drafts";
import type { AgentBlock as AgentData, FirstResponderBlock } from "@/lib/dashboards/chat/loaders";
import type { AgentActionRow, EscalationReason, RuleResultRow } from "@/lib/dashboards/chat/escalations";

/**
 * La seccion del agente: como trabaja con las conversaciones nuevas.
 *
 * Cada porcentaje va con la cantidad detras ("86 % · 348 de 402"): un porcentaje
 * sobre cuatro conversaciones no significa lo mismo que sobre cuatrocientas, y
 * sin el numero no hay forma de saber cual de los dos es.
 */

export function AgentRates({ data }: { data: AgentData }) {
  return (
    <div className="g3">
      {data.rates.map((rate) => {
        const previous = data.previousPercent[rate.key] ?? null;
        const cmp = comparePoints(rate.percent, previous, rate.lessIsBetter ? "less-is-better" : "more-is-better");
        return (
          <div key={rate.key} className="flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-border bg-card p-[18px]">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
              <span className="truncate">{rate.title}</span>
              <InfoTooltip text={rate.tooltip} label={`Qué significa ${rate.title}`} />
            </p>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[32px] font-semibold leading-tight tracking-tight tabular-nums">
                  {rate.percent === null ? "—" : `${rate.percent} %`}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatCount(rate.count)} de {formatCount(rate.total)} conversaciones nuevas
                </p>
              </div>
              <Sparkline
                values={rate.weekly}
                color={rate.key === "escalated" ? "var(--c-team)" : "var(--c-agent)"}
                label={`${rate.title}, últimas 8 semanas`}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {cmp.points === null ? (
                cmp.label
              ) : (
                <>
                  <b className={cn("font-semibold", cmp.tone === "good" ? "text-good" : cmp.tone === "bad" ? "text-bad" : "")}>
                    {cmp.label.split(" vs.")[0]}
                  </b>{" "}
                  vs. período anterior · últimas 8 semanas
                </>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** El aviso que reemplaza la seccion cuando el filtro no es el agente. */
export function AgentHidden({ notice, onClear }: { notice: string; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-card p-[18px] text-sm text-muted-foreground">
      <Bot className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
      <span className="min-w-[220px] flex-1">{notice}</span>
      <button
        type="button"
        onClick={onClear}
        className="h-8 shrink-0 rounded-lg border border-input px-3 text-sm font-medium transition-colors hover:bg-accent"
      >
        Ver todos
      </button>
    </div>
  );
}

/** El agente todavia no hizo nada: se dice, no se muestran cinco 0 %. */
export function AgentNoRuns({ agentHref }: { agentHref: string | null }) {
  return (
    <EmptyBlock
      icon={<Bot className="h-6 w-6" aria-hidden />}
      title="El agente todavía no respondió ninguna conversación"
      text="Cuando empiece a trabajar en este período, acá vas a ver en cuántas conversaciones actuó, cuántas tomó desde el primer mensaje y cuántas derivó."
      action={
        agentHref ? (
          <Link href={agentHref} className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
            Ver la configuración del agente
          </Link>
        ) : null
      }
    />
  );
}

/** Barra de 100 % de quien respondio primero, con la leyenda y las cantidades. */
export function FirstResponderCard({ data }: { data: FirstResponderBlock }) {
  return (
    <Panel
      title="Quién respondió primero"
      subtitle={`Sobre ${formatCount(data.total)} conversaciones nuevas`}
      footer={
        <span>
          “Fuera del sistema” son respuestas desde la app de Instagram o desde ManyChat: el sistema las ve, pero no sabe
          quién las mandó.
        </span>
      }
    >
      <div className="px-[18px] pb-[18px] pt-1">
        <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[5px]" role="img" aria-label="Quién respondió primero">
          {data.slices.map((s) =>
            s.episodes > 0 ? (
              <span
                key={s.key}
                title={`${s.label}: ${s.percent ?? 0} %`}
                style={{ width: `${s.percent ?? 0}%`, backgroundColor: s.color }}
                className="h-full first:rounded-l-[5px] last:rounded-r-[5px]"
              />
            ) : null,
          )}
        </div>
        <ul className="mt-3.5 grid gap-x-[18px] gap-y-2 sm:grid-cols-2">
          {data.slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-[13px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden />
              <span className="min-w-0 truncate">{s.label}</span>
              <b className="ml-auto font-semibold tabular-nums">{formatCount(s.episodes)}</b>
              <span className="w-10 text-right text-muted-foreground tabular-nums">{s.percent === null ? "—" : `${s.percent} %`}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/** Lista de barras simple, para "Por qué derivó" y "Acciones del agente". */
function BarRows({
  rows,
}: {
  rows: Array<{ key: string; label: string; value: number; hint?: string | null; color?: string }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3 px-[18px] pb-[18px] pt-1.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">{r.label}</span>
            <b className="shrink-0 font-semibold tabular-nums">
              {formatCount(r.value)}
              {r.hint ? <span className="ml-1.5 font-normal text-muted-foreground">{r.hint}</span> : null}
            </b>
          </div>
          <div className="h-2 overflow-hidden rounded-[4px] bg-muted">
            <div className="h-full rounded-[4px]" style={{ width: `${(r.value / max) * 100}%`, backgroundColor: r.color ?? "var(--c-agent)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EscalationReasonsCard({ reasons }: { reasons: EscalationReason[] }) {
  const total = reasons.reduce((n, r) => n + r.count, 0);
  if (reasons.length === 0) {
    return (
      <Panel title="Por qué derivó">
        <p className="px-[18px] pb-[18px] pt-1 text-sm text-muted-foreground">
          El agente no derivó ninguna conversación en este período.
        </p>
      </Panel>
    );
  }
  return (
    <Panel
      title="Por qué derivó"
      subtitle={`${formatCount(total)} derivaciones`}
      footer={<span>El motivo lo escribe el agente al derivar. Las variantes de una misma frase se cuentan juntas.</span>}
    >
      <BarRows
        rows={reasons.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.count,
          hint: r.pct === null ? null : `${r.pct} %`,
          color: "var(--c-team)",
        }))}
      />
    </Panel>
  );
}

export function AgentActionsCard({ actions, actionsHref }: { actions: AgentActionRow[]; actionsHref: string | null }) {
  if (actions.length === 0) {
    return (
      <Panel title="Acciones del agente">
        <p className="px-[18px] pb-[18px] pt-1 text-sm text-muted-foreground">
          El agente todavía no tocó el CRM en este período.
        </p>
      </Panel>
    );
  }
  const reverted = actions.reduce((n, a) => n + a.reverted, 0);
  return (
    <Panel
      title="Acciones del agente"
      subtitle="Cantidad en el período"
      footer={
        <>
          <span>
            Cada acción se puede revisar y revertir en Agentes → Acciones.
            {reverted > 0 ? ` ${reverted} ya se revirtieron.` : ""}
          </span>
          {actionsHref && (
            <Link href={actionsHref} className="font-medium text-primary underline-offset-2 hover:underline">
              Ver acciones
            </Link>
          )}
        </>
      }
    >
      <BarRows rows={actions.map((a) => ({ key: a.action, label: a.label, value: a.count }))} />
    </Panel>
  );
}

/** Los resultados de las reglas: solo si algun canal decide por reglas. */
export function RuleResultsCard({ rows }: { rows: RuleResultRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel title="Resultados de las reglas" subtitle="Todavía no corrió ningún turno con reglas">
        <p className="px-[18px] pb-[18px] pt-1 text-sm text-muted-foreground">
          Cuando un canal esté en “Según reglas”, acá vas a ver qué decidió cada regla.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Resultados de las reglas" subtitle="Qué decidió cada regla en el período">
      <ul className="flex flex-col gap-2 px-[18px] pb-[18px] pt-1.5 text-[13px]">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 last:border-b-0 last:pb-0">
            <span className="min-w-0">
              <span className="font-medium">{r.label}</span>
              <span className="text-muted-foreground">: {r.actionLabel}</span>
              {r.degradedToDraft > 0 && (
                <span className="mt-0.5 block text-xs text-warn">
                  {r.degradedToDraft} quedaron en borrador igual: falló el refresco contra el canal
                </span>
              )}
            </span>
            <b className="font-semibold tabular-nums">{formatCount(r.runs)}</b>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * "Aprobación de respuestas".
 *
 * Sin canales en modo borrador no muestra ceros: explica que activarlo es lo que
 * hace que esta tarjeta tenga datos.
 */
export function ApprovalCard({
  card,
  channelsLabel,
  hasDraftChannels,
  queueHref,
  agentHref,
}: {
  card: DraftsCard;
  channelsLabel: string;
  hasDraftChannels: boolean;
  queueHref: string;
  agentHref: string | null;
}) {
  if (!hasDraftChannels) {
    return (
      <Panel title="Aprobación de respuestas">
        <div className="flex flex-wrap items-center gap-3 px-[18px] pb-[18px] pt-1 text-sm text-muted-foreground">
          <span className="min-w-[220px] flex-1">
            Ningún canal está en modo borrador: el agente envía directo. Cuando actives el modo borrador en un canal, acá
            vas a ver cuántas respuestas se aprueban sin cambios.
          </span>
          {agentHref && (
            <Link href={agentHref} className="h-8 shrink-0 rounded-lg border border-input px-3 text-sm font-medium leading-8 transition-colors hover:bg-accent">
              Configurar canales del agente
            </Link>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Aprobación de respuestas"
      subtitle={channelsLabel}
      footer={
        <>
          <span>Descartar a propósito no cuenta como ventana perdida.</span>
          <Link href={queueHref} className="font-medium text-primary underline-offset-2 hover:underline">
            Abrir la cola
          </Link>
        </>
      }
    >
      <div className="px-[18px] pt-1">
        <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-[5px]" role="img" aria-label="Qué pasó con los borradores">
          {card.outcomes.map((o) =>
            o.count > 0 ? (
              <span
                key={o.key}
                title={`${o.label}: ${o.percent ?? 0} %`}
                style={{ width: `${o.percent ?? 0}%`, backgroundColor: o.color }}
                className="h-full first:rounded-l-[5px] last:rounded-r-[5px]"
              />
            ) : null,
          )}
        </div>
        <ul className="mt-3.5 grid gap-x-[18px] gap-y-2 sm:grid-cols-2">
          {card.outcomes.map((o) => (
            <li key={o.key} className="flex items-center gap-2 text-[13px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: o.color }} aria-hidden />
              <span className="min-w-0 truncate">{o.label}</span>
              <b className="ml-auto font-semibold tabular-nums">{formatCount(o.count)}</b>
              <span className="w-10 text-right text-muted-foreground tabular-nums">{o.percent === null ? "—" : `${o.percent} %`}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Sparkline values={card.uneditedWeekly} goal={DIRECT_SEND_REFERENCE_PCT} label="Aprobadas sin cambios, últimas 8 semanas" />
          <span className="min-w-[220px] flex-1">
            Aprobadas sin cambios, últimas 8 semanas. <b className="text-foreground">Referencia: {DIRECT_SEND_REFERENCE_PCT} %.</b>{" "}
            {card.aboveReference
              ? "Se sostiene por encima: conviene evaluar pasar el canal a envío directo."
              : "Si se sostiene por encima, conviene evaluar pasar el canal a envío directo."}
          </span>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-4">
        <Stat label="Pendientes ahora" value={formatCount(card.pendingNow)} hint={card.pendingUnder6h > 0 ? `${card.pendingUnder6h} con menos de 6 h` : "ninguno por vencer"} tone={card.pendingNow > 0 ? "warn" : undefined} />
        <Stat label="Lo que tarda el agente" value={formatDuration(card.agentMedianSeconds)} hint="incluye la espera de la ráfaga" />
        <Stat label="Lo que tarda la aprobación" value={formatDuration(card.approvalMedianSeconds)} hint="mediana · es lo que se puede mejorar" />
        <Stat label="Ventanas perdidas" value={formatCount(card.missedLast7d)} hint="últimos 7 días, vencieron sin enviarse" tone={card.missedLast7d > 0 ? "bad" : undefined} />
      </div>
    </Panel>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "warn" | "bad" }) {
  return (
    <div className="bg-card px-[18px] py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>{value}</p>
      <p className="text-[11.5px] text-muted-foreground/80">{hint}</p>
    </div>
  );
}
