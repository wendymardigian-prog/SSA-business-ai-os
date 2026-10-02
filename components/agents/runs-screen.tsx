"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Activity, ChevronDown, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunFilters, RunRow, RunsScreenOptions } from "@/lib/agent/screen";
import { RUN_SOURCE_LABELS, RUN_STATUS_LABELS, TRIGGER_LABELS, describeModelError, describeRunDetail } from "@/lib/agent/run-labels";
import { AGENT_FILTER_ALL, AGENT_FILTER_NONE, countActiveRunFilters } from "@/lib/agent/runs-query";
import { RUN_DETAIL_FILTERS } from "@/lib/agent/runs-filters";
import { RUN_SHORTCUTS, isShortcutActive, shortcutParams } from "@/lib/agent/runs-shortcuts";
import { formatDateTime } from "@/components/contacts/ui";
import { EmptyState, FilterSelect, Pagination, formatUsd, useUrlFilters } from "./filters";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import { RunDetail, RunStatusBadge } from "./run-detail";

/**
 * La pantalla global de Corridas (R1-R4): los once filtros de siempre mas
 * origen, en un popover sobre `FilterMenu` (R2), la tabla de doce columnas
 * (R3) con el detalle compartido expandible (R4), y el export a CSV.
 */
export function RunsScreen({
  rows,
  total,
  pageSize,
  filters,
  showCost,
  isAdmin,
  options,
}: {
  rows: RunRow[];
  total: number;
  pageSize: number;
  filters: RunFilters;
  showCost: boolean;
  isAdmin: boolean;
  options: RunsScreenOptions;
}) {
  const { pending, setParam, setPage, clearAll } = useUrlFilters();
  const activeCount = countActiveRunFilters(filters, null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const agentHrefFor = (agentId: string) => `/dashboard/agents/${agentId}?tab=actions`;

  return (
    <div className="space-y-4">
      {!isAdmin && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Ves solo las corridas de tus conversaciones. Owner y Admin ven todo el workspace.
        </p>
      )}

      {/* Atajos de un clic (R2) */}
      <div className="flex flex-wrap gap-2">
        {RUN_SHORTCUTS.filter((s) => !s.needsCost || showCost).map((s) => {
          const active = isShortcutActive(s.key, { resultado: filters.resultado, sinPrecio: filters.sinPrecio, masLentas: filters.masLentas, masCaras: filters.masCaras });
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                if (active) {
                  // Vuelve a apagarlo: limpia lo que ese atajo puso.
                  if (s.key === "errores" || s.key === "escaladas") setParam("resultado", "");
                  else setParam(Object.keys(shortcutParams(s.key))[0], "");
                } else {
                  for (const [k, v] of Object.entries(shortcutParams(s.key))) setParam(k, v);
                }
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent",
              )}
              aria-pressed={active}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Filtros, en un solo popover (R2) */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu label="Filtros" value={activeCount > 0 ? activeCount : "todos"} active={activeCount > 0} align="left" menuClassName="topbar:w-[360px] space-y-3 p-3">
          <div className="space-y-3">
            <div>
              <MenuGroupLabel>Agente y canal</MenuGroupLabel>
              <div className="flex flex-col gap-2 px-1">
                <select aria-label="Agente" value={filters.agente} onChange={(e) => setParam("agente", e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  <option value={AGENT_FILTER_ALL}>Agente: todos</option>
                  {options.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      Agente: {a.name}
                    </option>
                  ))}
                  <option value={AGENT_FILTER_NONE}>Sin agente (flows, secuencias, indexación)</option>
                </select>
                <FilterSelect label="Canal" value={filters.canal} onChange={(v) => setParam("canal", v)} options={options.channels.map((c) => ({ value: c.id, label: c.label }))} />
              </div>
            </div>
            <div>
              <MenuGroupLabel>Qué fue</MenuGroupLabel>
              <div className="flex flex-col gap-2 px-1">
                <FilterSelect label="Origen" value={filters.origen} onChange={(v) => setParam("origen", v)} options={options.sources.map((s) => ({ value: s, label: RUN_SOURCE_LABELS[s] ?? s }))} />
                <FilterSelect
                  label="Resultado"
                  value={filters.resultado}
                  onChange={(v) => setParam("resultado", v)}
                  options={Object.entries(RUN_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                />
                <FilterSelect label="Modelo" value={filters.modelo} onChange={(v) => setParam("modelo", v)} options={options.models.map((m) => ({ value: m, label: m }))} />
                <FilterSelect label="Acción ejecutada" allLabel="cualquiera" value={filters.accion} onChange={(v) => setParam("accion", v)} options={options.tools.map((t) => ({ value: t.name, label: t.label }))} />
                {options.rules.length > 1 && (
                  <FilterSelect label="Regla" allLabel="cualquiera" value={filters.regla} onChange={(v) => setParam("regla", v)} options={options.rules} />
                )}
                <FilterSelect label="Qué pasó" allLabel="cualquier cosa" value={filters.detalle} onChange={(v) => setParam("detalle", v)} options={RUN_DETAIL_FILTERS} />
              </div>
            </div>
            <div>
              <MenuGroupLabel>Contacto</MenuGroupLabel>
              <div className="px-1">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = (new FormData(e.currentTarget).get("q") as string) ?? "";
                    setParam("q", q.trim());
                  }}
                >
                  <input name="q" type="search" defaultValue={filters.q} placeholder="Buscar por contacto…" aria-label="Buscar por contacto" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                </form>
              </div>
            </div>
            {showCost && (
              <div>
                <MenuGroupLabel>Costo</MenuGroupLabel>
                <div className="flex items-center gap-1.5 px-1 text-sm">
                  <input type="number" min={0} step={0.01} placeholder="USD mín" aria-label="Costo mínimo" defaultValue={filters.costoMin ?? ""} onBlur={(e) => setParam("costo_min", e.target.value)} className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm" />
                  <span className="text-xs text-muted-foreground">a</span>
                  <input type="number" min={0} step={0.01} placeholder="USD máx" aria-label="Costo máximo" defaultValue={filters.costoMax ?? ""} onBlur={(e) => setParam("costo_max", e.target.value)} className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm" />
                </div>
              </div>
            )}
          </div>
        </FilterMenu>

        {activeCount > 0 && (
          <button type="button" onClick={() => clearAll(["range", "from", "to"])} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
            {activeCount} filtro{activeCount === 1 ? "" : "s"} activo{activeCount === 1 ? "" : "s"} · Limpiar
          </button>
        )}
        {pending && <span className="text-xs text-muted-foreground">Actualizando…</span>}

        <a
          href={`/api/v1/agent-runs/export?${new URLSearchParams(Object.fromEntries(Object.entries({ ...filters }).filter(([, v]) => v !== "" && v !== null && v !== false).map(([k, v]) => [k, String(v)]))).toString()}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Exportar CSV
        </a>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="No hay corridas con este filtro"
          text="Las corridas aparecen acá en cuanto un agente, un flow, una secuencia o cualquier otra fuente de IA registre una. Probá ampliar el período o limpiar los filtros."
          filtered={activeCount > 0}
          onClear={() => clearAll(["range", "from", "to"])}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Cuándo</th>
                  <th className="px-3 py-2 font-medium">Origen</th>
                  <th className="px-3 py-2 font-medium">Disparador</th>
                  <th className="px-3 py-2 font-medium">Contacto</th>
                  <th className="px-3 py-2 font-medium">Canal</th>
                  <th className="px-3 py-2 font-medium">Modelo</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Motivo</th>
                  <th className="px-3 py-2 text-right font-medium">Pasos</th>
                  <th className="px-3 py-2 text-right font-medium">Duración</th>
                  {showCost && <th className="px-3 py-2 text-right font-medium">Tokens</th>}
                  {showCost && <th className="px-3 py-2 text-right font-medium">Costo</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((run) => {
                  const open = expanded === run.id;
                  const motivo = [...describeRunDetail(run.statusDetail), run.error ? describeModelError(run.error) : null].filter(Boolean)[0] ?? "—";
                  const totalTokens = run.cost ? (run.cost.inputTokens ?? 0) + (run.cost.outputTokens ?? 0) + (run.cost.cachedTokens ?? 0) + (run.cost.embeddingTokens ?? 0) : null;
                  return (
                    <Fragment key={run.id}>
                      <tr className="cursor-pointer hover:bg-accent/30" onClick={() => setExpanded(open ? null : run.id)}>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
                            {formatDateTime(run.createdAt)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {RUN_SOURCE_LABELS[run.source] ?? run.source}
                          {run.source === "agent" && run.agentName ? ` · ${run.agentName}` : ""}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{TRIGGER_LABELS[run.trigger] ?? run.trigger}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {run.contactId ? (
                            <Link href={`/dashboard/contacts/${run.contactId}`} className="underline underline-offset-2" onClick={(e) => e.stopPropagation()}>
                              {run.contactName ?? "Contacto sin nombre"}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{run.channelLabel ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{run.model ? `${run.provider}/${run.model}` : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <RunStatusBadge status={run.status} />
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground" title={typeof motivo === "string" ? motivo : undefined}>
                          {motivo}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{run.stepCount}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{run.latencyMs !== null ? `${(run.latencyMs / 1000).toFixed(1)} s` : "—"}</td>
                        {showCost && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{totalTokens ?? "—"}</td>}
                        {showCost && (
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {run.cost?.usd === null ? <span className="text-warn">sin precio</span> : formatUsd(run.cost?.usd)}
                          </td>
                        )}
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={showCost ? 12 : 10} className="bg-muted/20 px-4 py-4">
                            <RunDetail run={run} showCost={showCost} agentHref={agentHrefFor} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={filters.page} total={total} pageSize={pageSize} onPage={setPage} />
        </>
      )}

      {showCost && rows.some((r) => r.cost && r.cost.usd === null && r.status !== "running") && (
        <p className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
          Alguna corrida no tiene costo calculado: falta el precio de su modelo en la tabla de precios.
        </p>
      )}
    </div>
  );
}
