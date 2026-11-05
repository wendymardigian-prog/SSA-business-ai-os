"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Loader2, RefreshCw, Search } from "lucide-react";
import { DateFilter, EmptyState, FilterBar, FilterSelect, Pagination, useUrlFilters } from "@/components/agents/filters";
import {
  RUN_STATES,
  RUN_STATE_CLASSES,
  RUN_STATE_LABELS,
  RUNS_PAGE_SIZE,
  countActiveFlowRunFilters,
  deriveRunState,
  formatRunDate,
  formatRunDuration,
  runSourceLabel,
  type FlowRunFilters,
} from "@/lib/flows/runs";
import type { FlowRunRow, FlowRunStep } from "@/lib/flows/runs-query";
import { cn } from "@/lib/utils";
import { FlowRunSheet } from "./flow-run-sheet";

export function RunStateBadge({ run }: { run: FlowRunRow }) {
  const state = deriveRunState(run);
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", RUN_STATE_CLASSES[state])}>{RUN_STATE_LABELS[state]}</span>;
}

/** Sin contacto (un flujo de webhook o sobre el equipo) o con el contacto borrado: se dice, no se deja vacio. */
export function runContactName(run: FlowRunRow): string {
  if (!run.contact_id) return "Sin contacto";
  return run.contact?.display_name?.trim() || "Contacto no disponible";
}

function RunSearch({ initial, onApply }: { initial: string; onApply: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(value.trim());
      }}
      className="relative"
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value.trim() !== initial) onApply(value.trim());
        }}
        placeholder="Buscar contacto"
        aria-label="Buscar por contacto"
        className="w-48 rounded-lg border border-input bg-background py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </form>
  );
}

/**
 * Las ejecuciones de una automatizacion. Los filtros y la ejecucion abierta viven en la URL: cambiar uno es una
 * navegacion y el servidor rehace la consulta.
 */
export function FlowRunsScreen({
  rows,
  total,
  loadFailed,
  filters,
  timeZone,
  detail,
}: {
  rows: FlowRunRow[];
  total: number;
  loadFailed: boolean;
  filters: FlowRunFilters;
  timeZone: string;
  detail: { run: FlowRunRow; steps: FlowRunStep[] } | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { pending, setParam, setPage, clearAll } = useUrlFilters();
  const [refreshing, startRefresh] = useTransition();
  const activeCount = countActiveFlowRunFilters(filters);

  function hrefFor(runId: string | null): string {
    const next = new URLSearchParams(searchParams.toString());
    if (runId) next.set("ejecucion", runId);
    else next.delete("ejecucion");
    const query = next.toString();
    return query ? `?${query}` : "?";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <FilterBar activeCount={activeCount} onClear={() => clearAll([])} pending={pending}>
          {/* La clave lo reinicia cuando la busqueda cambia desde afuera (por ejemplo, «Limpiar filtros»). */}
          <RunSearch key={filters.q} initial={filters.q} onApply={(value) => setParam("q", value)} />
          <FilterSelect
            label="Estado"
            value={filters.estado}
            onChange={(value) => setParam("estado", value)}
            options={RUN_STATES.map((state) => ({ value: state, label: RUN_STATE_LABELS[state] }))}
          />
          <DateFilter preset={filters.fecha} from={filters.desde} to={filters.hasta} setParam={setParam} />
        </FilterBar>
        <button
          type="button"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Actualizar
        </button>
      </div>

      {loadFailed ? (
        <div role="alert" className="rounded-xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
          No se pudieron cargar las ejecuciones. Probá con «Actualizar» en un momento.
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          title="Esta automatización todavía no corrió"
          text="Cuando se dispare, cada ejecución aparece acá: quién pasó, cuándo y qué pasó en cada paso."
          filtered={activeCount > 0}
          onClear={() => clearAll([])}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full table-fixed text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Contacto</th>
                  <th scope="col" className="w-36 px-4 py-2.5 font-medium">Estado</th>
                  <th scope="col" className="hidden w-40 px-4 py-2.5 font-medium lg:table-cell">Origen</th>
                  <th scope="col" className="hidden w-48 px-4 py-2.5 font-medium sm:table-cell">Empezó</th>
                  <th scope="col" className="hidden w-28 px-4 py-2.5 font-medium md:table-cell">Duración</th>
                  <th scope="col" className="hidden w-20 px-4 py-2.5 font-medium lg:table-cell">Versión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((run) => (
                  <tr key={run.id} className={cn("relative transition-colors hover:bg-accent/50", detail?.run.id === run.id && "bg-accent/50")}>
                    <td className="px-4 py-3">
                      <Link href={hrefFor(run.id)} scroll={false} className="block truncate font-medium after:absolute after:inset-0 focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring">
                        {runContactName(run)}
                      </Link>
                      <span className="mt-0.5 block text-xs text-muted-foreground sm:hidden">{formatRunDate(run.created_at, timeZone)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <RunStateBadge run={run} />
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{runSourceLabel(run.source_type)}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground sm:table-cell">{formatRunDate(run.created_at, timeZone)}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{formatRunDuration(run.created_at, run.finished_at)}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{run.flow_version ? `v${run.flow_version}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={filters.page} total={total} pageSize={RUNS_PAGE_SIZE} onPage={setPage} />
        </>
      )}

      {detail && (
        <FlowRunSheet
          run={detail.run}
          steps={detail.steps}
          timeZone={timeZone}
          onClose={() => router.replace(hrefFor(null), { scroll: false })}
        />
      )}
    </div>
  );
}
