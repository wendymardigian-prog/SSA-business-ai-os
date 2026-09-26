"use client";

import Link from "next/link";
import { Activity, AlertTriangle, ChevronDown } from "lucide-react";
import type { AgentScreenData, RunRow, RunStepRow } from "@/lib/agent/screen";
import { RUN_SOURCE_LABELS, RUN_STATUS_LABELS, STEP_KIND_LABELS, describeRunDetail } from "@/lib/agent/run-labels";
import { routingSentence } from "@/lib/agent/routing-sentence";
import { countActiveRunFilters, AGENT_FILTER_ALL, AGENT_FILTER_NONE } from "@/lib/agent/runs-query";
import { formatDateTime } from "@/components/contacts/ui";
import { cn } from "@/lib/utils";
import { Notice } from "./fields";
import { DateFilter, EmptyState, FilterBar, FilterSelect, Pagination, formatUsd, useUrlFilters } from "./filters";

/**
 * Pestana Runs (F28): una fila por turno del agente (y por cada otra llamada a
 * IA del sistema), con filtros en la URL y el detalle expandible de cada run,
 * contado como una historia: que paso, que busco, que hizo, que costo.
 *
 * Un Member ve solo los runs de sus conversaciones y sin la columna de costo:
 * eso lo decide el servidor (RLS + columnas), aca solo no se dibuja.
 */

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

export function RunsTab({ data }: { data: AgentScreenData }) {
  const runs = data.runs;
  const { pending, setParam, setPage, clearAll, get } = useUrlFilters();
  if (!runs) return null;
  const { filters, rows, total, pageSize, options, showCost, anyRuns, refreshHealth } = runs;
  const activeCount = countActiveRunFilters(filters, data.agent.id);

  return (
    <div className="space-y-4">
      <FilterBar activeCount={activeCount} onClear={() => clearAll(["tab"])} pending={pending}>
        <DateFilter preset={filters.datePreset} from={filters.dateFrom} to={filters.dateTo} setParam={setParam} />
        <select
          aria-label="Agente"
          value={filters.agente}
          onChange={(e) => setParam("agente", e.target.value)}
          className={cn("rounded-lg border bg-background px-3 py-2 text-sm", filters.agente !== data.agent.id ? "border-primary" : "border-input text-muted-foreground")}
        >
          {options.agents.map((a) => (
            <option key={a.id} value={a.id}>
              Agente: {a.name}
            </option>
          ))}
          <option value={AGENT_FILTER_ALL}>Agente: todos</option>
          <option value={AGENT_FILTER_NONE}>Sin agente (flows, secuencias, indexación)</option>
        </select>
        <FilterSelect label="Canal" value={filters.canal} onChange={(v) => setParam("canal", v)} options={options.channels.map((c) => ({ value: c.id, label: c.label }))} />
        <FilterSelect
          label="Resultado"
          value={filters.resultado}
          onChange={(v) => setParam("resultado", v)}
          options={Object.entries(RUN_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <FilterSelect label="Modelo" value={filters.modelo} onChange={(v) => setParam("modelo", v)} options={options.models.map((m) => ({ value: m, label: m }))} />
        <FilterSelect label="Acción ejecutada" allLabel="cualquiera" value={filters.accion} onChange={(v) => setParam("accion", v)} options={options.tools.map((t) => ({ value: t.name, label: t.label }))} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = (new FormData(e.currentTarget).get("q") as string) ?? "";
            setParam("q", q.trim());
          }}
        >
          <input name="q" type="search" defaultValue={filters.q} placeholder="Contacto…" aria-label="Buscar por contacto" className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </form>
        {showCost && (
          <div className="flex items-center gap-1 text-sm">
            <input type="number" min={0} step={0.01} placeholder="USD mín" aria-label="Costo mínimo" defaultValue={filters.costoMin ?? ""} onBlur={(e) => setParam("costo_min", e.target.value)} className="w-24 rounded-lg border border-input bg-background px-2 py-2 text-sm" />
            <span className="text-xs text-muted-foreground">a</span>
            <input type="number" min={0} step={0.01} placeholder="USD máx" aria-label="Costo máximo" defaultValue={filters.costoMax ?? ""} onBlur={(e) => setParam("costo_max", e.target.value)} className="w-24 rounded-lg border border-input bg-background px-2 py-2 text-sm" />
          </div>
        )}
        {(filters.contacto || filters.conversacion) && (
          <button type="button" onClick={() => { setParam("contacto", ""); setParam("c", ""); }} className="rounded-full border border-primary px-2 py-1 text-xs">
            {filters.conversacion ? "Solo esta conversación ×" : "Solo este contacto ×"}
          </button>
        )}
      </FilterBar>

      {refreshHealth.total >= 20 && (
        <p className={cn("text-xs", refreshHealth.failedPct > 5 ? "text-amber-700" : "text-muted-foreground")}>
          Refresco contra Zernio (7 días): {refreshHealth.failedPct}% falló sobre {refreshHealth.total} turnos.
          {refreshHealth.failedPct > 5 ? " Sin refresco, la verificación antes de responder queda ciega." : ""}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="El agente todavía no respondió ninguna conversación"
          text="Los runs aparecen acá en cuanto el agente esté encendido, atienda un canal y entre un mensaje. Cada turno deja un run, también cuando se abstiene: nunca hay silencios sin explicación."
          filtered={anyRuns || activeCount > 0}
          onClear={() => clearAll(["tab"])}
        />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {rows.map((run) => (
              <RunItem key={run.id} run={run} showCost={showCost} />
            ))}
          </ul>
          <Pagination page={filters.page} total={total} pageSize={pageSize} onPage={setPage} />
        </>
      )}

      {showCost && rows.some((r) => r.cost && r.cost.usd === null && r.status !== "running") && (
        <Notice tone="warning">Algún run no tiene costo calculado: falta el precio de su modelo en la tabla de precios (pestaña Costos).</Notice>
      )}
    </div>
  );
}

function RunItem({ run, showCost }: { run: RunRow; showCost: boolean }) {
  const details = describeRunDetail(run.statusDetail);
  const tools = run.steps.filter((s) => s.kind === "tool_call" && s.name && !s.error).map((s) => s.name as string);
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-accent/40">
          <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[run.status] ?? "bg-muted text-muted-foreground")}>
                {RUN_STATUS_LABELS[run.status] ?? run.status}
              </span>
              <span className="text-sm font-medium">{run.contactName ?? (run.conversationId ? "Contacto sin nombre" : RUN_SOURCE_LABELS[run.source] ?? run.source)}</span>
              {run.channelLabel && <span className="text-xs text-muted-foreground">· {run.channelLabel}</span>}
              {run.source !== "agent" && <span className="text-xs text-muted-foreground">· {RUN_SOURCE_LABELS[run.source] ?? run.source}</span>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatDateTime(run.createdAt)}
              {run.model ? ` · ${run.provider}/${run.model}` : ""}
              {run.promptVersion ? ` · prompt v${run.promptVersion}` : ""}
              {run.latencyMs !== null ? ` · ${(run.latencyMs / 1000).toFixed(1)} s` : ""}
              {tools.length > 0 ? ` · usó: ${[...new Set(tools)].join(", ")}` : ""}
              {details.length > 0 ? ` · ${details[0]}` : ""}
            </p>
          </div>
          {showCost && run.cost && (
            <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground" title="Estimado según los precios cargados">
              {formatUsd(run.cost.usd)}
            </span>
          )}
        </summary>

        <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3 pl-11 text-sm">
          {run.routing && (
            <p className="text-xs text-foreground">{routingSentence(run.routing as Parameters<typeof routingSentence>[0])}</p>
          )}
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
                  {run.error}
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold">Qué hizo, paso a paso</p>
            {run.steps.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Sin pasos: terminó antes de llamar al modelo.</p>
            ) : (
              <ol className="mt-1 space-y-1.5">
                {run.steps.map((step) => (
                  <StepItem key={step.id} step={step} />
                ))}
              </ol>
            )}
          </div>

          {showCost && run.cost && (
            <p className="text-xs text-muted-foreground">
              Tokens: {run.cost.inputTokens ?? 0} entrada · {run.cost.outputTokens ?? 0} salida
              {run.cost.cachedTokens ? ` · ${run.cost.cachedTokens} en caché` : ""}
              {run.cost.embeddingTokens ? ` · ${run.cost.embeddingTokens} embeddings` : ""} · {formatUsd(run.cost.usd)} (estimado)
            </p>
          )}

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
            <Link href={`/dashboard/agents/runs/${run.id}`} className="underline underline-offset-2">
              Ver el run solo
            </Link>
          </div>
        </div>
      </details>
    </li>
  );
}

function StepItem({ step }: { step: RunStepRow }) {
  const label = STEP_KIND_LABELS[step.kind] ?? step.kind;
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
      {step.input !== null && step.kind === "tool_call" && (
        <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-1.5 text-[10px] text-muted-foreground">{JSON.stringify(step.input, null, 1)}</pre>
      )}
      {step.output !== null && (
        <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-1.5 text-[10px] text-muted-foreground">{JSON.stringify(step.output, null, 1)}</pre>
      )}
      {step.error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{step.error}</p>}
    </li>
  );
}
