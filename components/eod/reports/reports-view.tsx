"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { Notice } from "@/components/agents/fields";
import { exportEodReportsCsv } from "@/lib/actions/eod/export";
import { metricCell, metricColumns, periodTotals, reportStatusLabel, REPORTS_PAGE_SIZE } from "@/lib/eod/reports";
import type { ReportsPageData } from "@/lib/eod/reports-load";
import { cn } from "@/lib/utils";

/**
 * La pestaña Reportes de un EOD (E9): filtros en la URL, totales del período, quién falta
 * hoy y una fila por persona y día con el total de cada métrica. Solo compone: las cuentas
 * son de `lib/eod/reports.ts`.
 */
export function ReportsView({ data }: { data: ReportsPageData }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [exporting, startExport] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const columns = metricColumns(data.metricKeys);
  const totals = periodTotals(data.rows, data.filters.channel);
  const pages = Math.max(1, Math.ceil(data.rows.length / REPORTS_PAGE_SIZE));
  const page = Math.min(data.filters.page, pages);
  const visible = data.rows.slice((page - 1) * REPORTS_PAGE_SIZE, page * REPORTS_PAGE_SIZE);
  const channelLabel = new Map(data.channels.map((c) => [c.key, c.label]));

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(search.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== "pagina") params.delete("pagina");
    router.push(`${pathname}?${params.toString()}`);
  }

  function exportCsv() {
    setMessage(null);
    startExport(async () => {
      const result = await exportEodReportsCsv({ formId: data.form.id, params: Object.fromEntries(search.entries()) });
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage({ tone: "success", text: `Exportados ${result.rows} reportes` });
    });
  }

  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: data.timeZone }) : "—");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="mb-1 block font-semibold">Desde</span>
          <input type="date" value={data.filters.from} max={data.today} onChange={(e) => setParam("desde", e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm" />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-semibold">Hasta</span>
          <input type="date" value={data.filters.to} max={data.today} onChange={(e) => setParam("hasta", e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm" />
        </label>
        {data.canViewAll && (
          <label className="text-xs">
            <span className="mb-1 block font-semibold">Persona</span>
            <select value={data.filters.person ?? ""} onChange={(e) => setParam("persona", e.target.value || null)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
              <option value="">Todas</option>
              {data.people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {data.channels.length > 0 && (
          <label className="text-xs">
            <span className="mb-1 block font-semibold">Canal</span>
            <select value={data.filters.channel ?? ""} onChange={(e) => setParam("canal", e.target.value || null)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
              <option value="">Todos</option>
              {data.channels.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={exportCsv} disabled={exporting || data.rows.length === 0} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />} Exportar CSV
        </button>
      </div>
      {message && (
        <div role="status">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <section aria-labelledby="eod-totals" className="rounded-xl border border-border bg-card p-4">
        <h2 id="eod-totals" className="text-sm font-semibold">
          Totales del período{data.filters.channel ? ` · ${channelLabel.get(data.filters.channel) ?? data.filters.channel}` : ""}
        </h2>
        <p className="text-xs text-muted-foreground">
          {totals.reports} {totals.reports === 1 ? "reporte enviado" : "reportes enviados"} entre el {data.filters.from} y el {data.filters.to}. Los borradores no suman.
        </p>
        {columns.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Este reporte no tiene preguntas que midan algo.</p>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {columns.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2">
                <dt className="text-[11px] text-muted-foreground">{c.label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{totals.total[c.key] ?? 0}</dd>
              </div>
            ))}
          </dl>
        )}
        {!data.filters.channel && Object.keys(totals.byChannel).length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold">Por canal</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">Canal</th>
                    {columns.map((c) => (
                      <th key={c.key} className="py-1 pr-3 text-right font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(totals.byChannel).map(([key, values]) => (
                    <tr key={key} className="border-t border-border">
                      <td className="py-1 pr-3">{channelLabel.get(key) ?? key}</td>
                      {columns.map((c) => (
                        <td key={c.key} className="py-1 pr-3 text-right tabular-nums">
                          {values[c.key] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      {data.pending && (
        <section aria-labelledby="eod-pending" className="rounded-xl border border-border bg-card p-4">
          <h2 id="eod-pending" className="text-sm font-semibold">
            Pendientes de hoy
          </h2>
          {data.pending.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Todos enviaron el de hoy.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {data.pending.map((p) => (
                <li key={p.userId} className={cn("rounded-full border px-2.5 py-1 text-xs", p.state === "draft" ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-border text-muted-foreground")}>
                  {p.name} · {p.state === "draft" ? "En curso" : "Sin empezar"}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No hay reportes en este período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Persona</th>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Enviado</th>
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-t border-border hover:bg-accent/40">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/formularios/${data.form.id}/reportes/${row.id}`} className="font-medium hover:underline">
                      {row.userName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.reportDate}</td>
                  <td className="px-3 py-2">{reportStatusLabel(row)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{time(row.submittedAt)}</td>
                  {columns.map((c) => {
                    const value = metricCell(row, c.key, data.filters.channel);
                    return (
                      <td key={c.key} className="px-3 py-2 text-right tabular-nums">
                        {value ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Páginas" className="flex items-center justify-end gap-2 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setParam("pagina", String(page - 1))} className="rounded-lg border border-border px-3 py-1 disabled:opacity-40">
            Anterior
          </button>
          <span className="text-xs text-muted-foreground">
            Página {page} de {pages}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setParam("pagina", String(page + 1))} className="rounded-lg border border-border px-3 py-1 disabled:opacity-40">
            Siguiente
          </button>
        </nav>
      )}
    </div>
  );
}
