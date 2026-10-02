"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { RunRow, RunStepRow } from "@/lib/agent/screen";
import {
  RUN_SOURCE_LABELS,
  RUN_STATUS_LABELS,
  STEP_KIND_LABELS,
  TRIGGER_LABELS,
  describeModelError,
  describeRunDetail,
} from "@/lib/agent/run-labels";
import { routingSentence } from "@/lib/agent/routing-sentence";
import { formatDateTime } from "@/components/contacts/ui";
import { formatUsd } from "./filters";
import { cn } from "@/lib/utils";

/**
 * El detalle de una corrida (R4): un solo componente para la tabla de
 * Corridas y para la pantalla `/dashboard/agents/runs/[runId]`. Antes eran
 * dos vistas que mostraban cosas distintas (el acordeón viejo de la pestaña
 * del agente mostraba mas que la pantalla sola); gana la mas completa.
 *
 * Doce meses sin contenido en un paso es `purge_agent_run_step_content`
 * (00059): no hay columna `purged_at`, asi que se infiere por la fecha del
 * paso. Decirlo evita un hueco sin explicacion.
 */

const PURGE_MONTHS = 12;

function isPurged(step: RunStepRow): boolean {
  if (step.input !== null || step.output !== null) return false;
  const ageMs = Date.now() - new Date(step.createdAt).getTime();
  return ageMs > PURGE_MONTHS * 30 * 24 * 60 * 60 * 1000;
}

const STATUS_TONE: Record<string, string> = {
  responded: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  escalated: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  blocked_guardrail: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  skipped: "bg-muted text-muted-foreground",
  skipped_automation: "bg-muted text-muted-foreground",
  running: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  error: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
};

export function RunStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[status] ?? "bg-muted text-muted-foreground")}>
      {RUN_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function RunDetail({
  run,
  showCost,
  agentHref,
}: {
  run: RunRow;
  showCost: boolean;
  /** Para el link a Acciones, cuando un paso tiene audit_log_id. */
  agentHref?: (agentId: string) => string;
}) {
  const details = describeRunDetail(run.statusDetail);
  const tools = run.steps.filter((s) => s.kind === "tool_call" && s.name && !s.error).map((s) => s.name as string);

  return (
    <div className="space-y-4 text-sm">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        <span className="font-medium">{RUN_SOURCE_LABELS[run.source] ?? run.source}</span>
        {run.agentName && <span className="text-xs text-muted-foreground">· {run.agentName}</span>}
        <span className="text-xs text-muted-foreground">· {formatDateTime(run.createdAt)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {run.model ? `${run.provider}/${run.model}` : "Sin modelo"}
        {run.promptVersion ? ` · prompt v${run.promptVersion}` : ""}
        {run.latencyMs !== null ? ` · ${(run.latencyMs / 1000).toFixed(1)} s` : ""}
        {` · ${TRIGGER_LABELS[run.trigger] ?? run.trigger}`}
      </p>
      {showCost && run.cost && (
        <p className="text-xs text-muted-foreground">
          Tokens: {run.cost.inputTokens ?? 0} entrada · {run.cost.outputTokens ?? 0} salida
          {run.cost.cachedTokens ? ` · ${run.cost.cachedTokens} en caché` : ""}
          {run.cost.embeddingTokens ? ` · ${run.cost.embeddingTokens} embeddings` : ""}
          {" · "}
          {run.cost.usd === null ? (
            <span className="font-medium text-warn">sin precio</span>
          ) : (
            <span>{formatUsd(run.cost.usd)} (precio congelado al cerrar la corrida)</span>
          )}
        </p>
      )}

      {/* Enrutamiento */}
      {run.routing && <p className="text-xs">{routingSentence(run.routing as Parameters<typeof routingSentence>[0])}</p>}

      {/* Por que termino asi */}
      {(details.length > 0 || run.error) && (
        <div>
          <p className="text-xs font-semibold">Por qué terminó así</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          {run.error && (
            <p className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {describeModelError(run.error)}
            </p>
          )}
        </div>
      )}

      {/* Paso a paso */}
      <div>
        <p className="text-xs font-semibold">Qué hizo, paso a paso{tools.length > 0 ? ` · usó: ${[...new Set(tools)].join(", ")}` : ""}</p>
        {run.steps.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Sin pasos: terminó antes de llamar al modelo.</p>
        ) : (
          <ol className="mt-1 space-y-1.5">
            {run.steps.map((step) => (
              <StepItem key={step.id} step={step} agentId={run.agentId} agentHref={agentHref} />
            ))}
          </ol>
        )}
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-3 text-xs">
        {run.conversationId && (
          <Link href={`/dashboard/inbox?c=${run.conversationId}`} className="underline underline-offset-2">
            Abrir la conversación
          </Link>
        )}
        {run.contactId && (
          <Link href={`/dashboard/contacts/${run.contactId}`} className="underline underline-offset-2">
            Ficha del contacto
          </Link>
        )}
      </div>
    </div>
  );
}

function StepItem({ step, agentId, agentHref }: { step: RunStepRow; agentId: string | null; agentHref?: (agentId: string) => string }) {
  const label = STEP_KIND_LABELS[step.kind] ?? step.kind;
  const purged = isPurged(step);
  return (
    <li className="rounded-md border border-border bg-card p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">
          {label}
          {step.name ? <span className="text-muted-foreground"> · {step.name}</span> : null}
        </p>
        {step.durationMs !== null && <span className="text-[11px] text-muted-foreground">{step.durationMs} ms</span>}
      </div>
      {step.kbChunks.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Usó {step.kbChunks.length} fragmento{step.kbChunks.length === 1 ? "" : "s"} de la base de conocimiento
          {step.kbChunks.some((c) => c.label) ? `: ${step.kbChunks.map((c) => c.label ?? "fragmento").join("; ")}` : "."}
        </p>
      )}
      {purged ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Contenido purgado por retención ({formatDateTime(step.createdAt)}, más de 12 meses).
        </p>
      ) : (
        <>
          {step.input !== null && (
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-1.5 text-[10px] text-muted-foreground">{JSON.stringify(step.input, null, 1)}</pre>
          )}
          {step.output !== null && (
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-1.5 text-[10px] text-muted-foreground">{JSON.stringify(step.output, null, 1)}</pre>
          )}
        </>
      )}
      {step.error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{describeModelError(step.error)}</p>}
      {step.auditLogId && agentId && agentHref && (
        <Link href={agentHref(agentId)} className="mt-1 inline-block text-[11px] underline underline-offset-2">
          Ver en Acciones del agente
        </Link>
      )}
    </li>
  );
}
