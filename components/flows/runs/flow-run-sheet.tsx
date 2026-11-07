"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Clock, Loader2, MinusCircle, RotateCcw, XCircle, type LucideIcon } from "lucide-react";
import { retryFlowStep } from "@/lib/actions/flow-runs";
import { Sheet } from "@/components/ui/sheet";
import {
  canRetryStep,
  formatRunDate,
  formatRunDuration,
  runEndReasonLabel,
  runSourceLabel,
  runStepReasonLabel,
  runStepStatusLabel,
  type RunStepStatus,
} from "@/lib/flows/runs";
import type { FlowRunRow, FlowRunStep } from "@/lib/flows/runs-query";
import { cn } from "@/lib/utils";
import { RunStateBadge, runContactName } from "./flow-runs-screen";

const STEP_ICONS: Record<RunStepStatus, { icon: LucideIcon; className: string }> = {
  ok: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  failed: { icon: XCircle, className: "text-red-600 dark:text-red-400" },
  skipped: { icon: MinusCircle, className: "text-muted-foreground" },
  waiting: { icon: Clock, className: "text-violet-600 dark:text-violet-400" },
  deferred: { icon: CalendarClock, className: "text-amber-600 dark:text-amber-400" },
};

/** Una ejecucion paso a paso. Un paso que se reintento aparece dos veces: es lo que paso de verdad. */
export function FlowRunSheet({
  flowId,
  canRetry,
  run,
  steps,
  timeZone,
  onClose,
}: {
  flowId: string;
  canRetry: boolean;
  run: FlowRunRow;
  steps: FlowRunStep[];
  timeZone: string;
  onClose: () => void;
}) {
  const endReason = runEndReasonLabel(run.end_reason);
  const lastFailureId = [...steps].reverse().find((s) => s.status === "failed")?.id ?? null;

  return (
    <Sheet title="Detalle de la ejecución" onClose={onClose}>
      <div className="space-y-5 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {run.contact_id && run.contact ? (
              <Link href={`/dashboard/contacts/${run.contact_id}`} className="font-medium underline-offset-2 hover:underline">
                {runContactName(run)}
              </Link>
            ) : (
              <span className="font-medium">{runContactName(run)}</span>
            )}
            <RunStateBadge run={run} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Fact label="Empezó" value={formatRunDate(run.created_at, timeZone)} />
            <Fact label="Terminó" value={formatRunDate(run.finished_at, timeZone)} />
            <Fact label="Duración" value={formatRunDuration(run.created_at, run.finished_at)} />
            <Fact label="Origen" value={runSourceLabel(run.source_type)} />
            <Fact label="Versión" value={run.flow_version ? `v${run.flow_version}` : "—"} />
          </dl>
        </div>

        {(endReason || run.error_message) && (
          <div role="status" className={cn("rounded-lg border px-3 py-2 text-sm", run.error_message ? "border-red-300/60 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200" : "border-border bg-muted/40 text-muted-foreground")}>
            {endReason && <p>{endReason}</p>}
            {run.error_message && <p className={cn("break-words", endReason && "mt-1 text-xs opacity-90")}>{run.error_message}</p>}
          </div>
        )}

        <section aria-label="Pasos">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pasos</h3>
          {steps.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No hay detalle de pasos para esta ejecución. El detalle se guarda desde que se activó esta función y durante 12 meses.
            </p>
          ) : (
            <ol className="mt-3">
              {steps.map((step, index) => {
                const isLast = index === steps.length - 1;
                const { icon: Icon, className } = STEP_ICONS[step.status];
                const reason = runStepReasonLabel(step.reason);
                return (
                  <li key={step.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {!isLast && <span aria-hidden className="absolute bottom-0 left-[9px] top-6 w-px bg-border" />}
                    <Icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", className)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium">{step.node_label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {runStepStatusLabel(step.status, isLast)} · {formatRunDate(step.started_at, timeZone)}
                      </p>
                      {step.resumes_at && isLast && <p className="mt-1 text-xs text-muted-foreground">Sigue el {formatRunDate(step.resumes_at, timeZone)}</p>}
                      {step.exit_label && <p className="mt-1 text-xs text-muted-foreground">Siguió por: {step.exit_label}</p>}
                      {reason && <p className={cn("mt-1 break-words text-xs", step.status === "failed" ? "text-red-700 dark:text-red-300" : "text-muted-foreground")}>{reason}</p>}
                      {step.status === "failed" && step.id === lastFailureId && canRetry && <RetryStep flowId={flowId} run={run} step={step} />}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </Sheet>
  );
}

/** «Reintentar desde este paso», o por que no se puede. La regla es `canRetryStep`; el servidor la vuelve a mirar. */
function RetryStep({ flowId, run, step }: { flowId: string; run: FlowRunRow; step: FlowRunStep }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const allowed = canRetryStep({
    stepStatus: step.status,
    errorKind: step.error_kind,
    nodeType: step.node_type,
    isLastFailure: true,
    runStatus: run.status,
    runCreatedAt: run.created_at,
  });

  if (!allowed.ok) return <p className="mt-1.5 text-xs text-muted-foreground">No se puede reintentar: {allowed.reason}</p>;

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={pending || message?.ok === true}
        onClick={() =>
          startTransition(async () => {
            const result = await retryFlowStep({ flowId, runId: run.id, stepId: step.id });
            if (result.ok) {
              setMessage({ ok: true, text: "Listo: en menos de un minuto vuelve a correr desde este paso. Tocá «Actualizar» para ver cómo salió." });
              router.refresh();
            } else {
              setMessage({ ok: false, text: result.error });
            }
          })
        }
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
        Reintentar desde este paso
      </button>
      {message && (
        <p role="status" className={cn("mt-1.5 text-xs", message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300")}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
