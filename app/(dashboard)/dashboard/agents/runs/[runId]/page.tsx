import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { getWorkspace } from "@/lib/workspace";
import { AGENT_RUN_PUBLIC_COLUMNS } from "@/lib/agent/public";
import {
  RUN_SOURCE_LABELS,
  RUN_STATUS_LABELS,
  STEP_KIND_LABELS,
  describeRunDetail,
} from "@/lib/agent/run-labels";
import { formatDateTime } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";

/**
 * Detalle de un run (minimo, Bloque 2a).
 *
 * Existe para que el punto rojo de la bandeja lleve a algun lado: que paso,
 * que busco, que decidio. El historial con filtros, las acciones y los costos
 * son las pestanas del Bloque 2b.
 *
 * Con el cliente del usuario: un Member solo abre runs de conversaciones que le
 * corresponden (RLS 00060) y nunca ve tokens ni costo (columnas explicitas).
 */
export default async function AgentRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { supabase, workspace } = await getWorkspace();

  const { data: run } = await supabase
    .from("agent_runs")
    .select(AGENT_RUN_PUBLIC_COLUMNS)
    .eq("id", runId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!run) notFound();

  const { data: steps } = await supabase
    .from("agent_run_steps")
    .select("id, step_index, kind, name, output, kb_chunk_ids, duration_ms, error, created_at")
    .eq("run_id", run.id)
    .order("step_index", { ascending: true });

  const details = describeRunDetail(run.status_detail);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/agents/runs/[runId]"
        title={RUN_STATUS_LABELS[run.status] ?? run.status}
        backHref={
          <Link
            href={run.conversation_id ? `/dashboard/inbox?c=${run.conversation_id}` : "/dashboard/inbox"}
            aria-label={run.conversation_id ? "Volver a la conversación" : "Volver a la bandeja"}
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
      />
      <div className="border-b border-border px-4 py-4 md:px-8">
        <p className="mt-1 text-sm text-muted-foreground">
          {RUN_SOURCE_LABELS[run.source] ?? run.source} · {formatDateTime(run.created_at)}
          {run.model ? ` · ${run.provider}/${run.model}` : ""}
          {run.latency_ms !== null ? ` · ${(run.latency_ms / 1000).toFixed(1)} s` : ""}
        </p>
      </div>

      <div className="flex-1 space-y-6 overflow-auto px-8 py-6">
        {(details.length > 0 || run.error) && (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Por qué terminó así</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            {run.error && (
              <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {run.error}
              </p>
            )}
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold">Qué hizo, paso a paso</h2>
          {!steps || steps.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Este run no tuvo pasos: terminó antes de llamar al modelo.
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {steps.map((step) => (
                <li key={step.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {STEP_KIND_LABELS[step.kind] ?? step.kind}
                      {step.name ? <span className="text-muted-foreground"> · {step.name}</span> : null}
                    </p>
                    {step.duration_ms !== null && (
                      <span className="text-xs text-muted-foreground">{step.duration_ms} ms</span>
                    )}
                  </div>
                  {step.kb_chunk_ids && step.kb_chunk_ids.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Usó {step.kb_chunk_ids.length} fragmento(s) de la base de conocimiento.
                    </p>
                  )}
                  {step.output !== null && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
                      {JSON.stringify(step.output, null, 2)}
                    </pre>
                  )}
                  {step.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{step.error}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
