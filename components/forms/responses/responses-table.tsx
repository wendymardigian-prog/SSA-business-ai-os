"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Download, Inbox, Loader2 } from "lucide-react";
import { ColumnCell } from "@/components/attribution/column-cell";
import { ColumnsMenu, useColumnPrefs } from "@/components/attribution/columns-menu";
import { Notice } from "@/components/agents/fields";
import { Pagination, useUrlFilters } from "@/components/agents/filters";
import { exportResponsesCsv } from "@/lib/actions/forms/responses";
import type { MetaRowNames } from "@/lib/forms/meta-names";
import { countMenuFilters, selectGroup } from "@/lib/forms/response-filters-view";
import { DIMENSION_LABELS, type GroupCount, type ResponseDimension } from "@/lib/forms/response-index";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import { ResponseGroups } from "./response-groups";
import { ResponsesFilterChips, ResponsesToolbarFilters, type ToolbarFilters } from "./responses-toolbar";
import { RESPONSE_COLUMN_GROUPS, originSummary, responseColumnDefs, responseColumnsStorageKey } from "@/lib/forms/response-columns";
import { cellFor, statusLabel, type ResponseColumn, type StoredAnswer, type SubmissionStatus } from "@/lib/forms/responses";
import { formatInZone } from "@/lib/forms/responses-query";
import { cn } from "@/lib/utils";

export interface ResponseTableRow {
  id: string;
  createdAt: string;
  status: SubmissionStatus;
  contactId: string | null;
  contactName: string | null;
  answers: Record<string, StoredAnswer>;
  score: number | null;
  npsCategory: string | null;
  attribution: Record<string, string>;
  metaNames: MetaRowNames;
  metaStatus: string;
}

const STATUS_STYLE: Record<SubmissionStatus, string> = {
  received: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  no_contact: "border-border text-muted-foreground",
  spam: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

export function ResponsesTable({
  header,
  formId,
  formType,
  rows,
  columns,
  total,
  baseTotal,
  truncated,
  page,
  pageSize,
  filters,
  dimensions,
  facets,
  groups,
  loadError,
  canManage,
  canExport = false,
  timeZone,
}: {
  /** La barra del editor (la arma el servidor: plano formularios-ui, F7). */
  header: React.ReactNode;
  formId: string;
  formType: "custom" | "survey" | "contract";
  rows: ResponseTableRow[];
  columns: ResponseColumn[];
  /** Las respuestas que pasan TODOS los filtros. */
  total: number;
  /** Las del período, estado y contacto, antes de buscar, país y UTM. */
  baseTotal: number;
  /** Había más que el tope (`FORM_LIMITS.exportMaxRows`): se ven las más nuevas. */
  truncated: boolean;
  page: number;
  pageSize: number;
  filters: ToolbarFilters;
  dimensions: ResponseDimension[];
  facets: Record<ResponseDimension, MultiFilterOption[]>;
  /** Con «Agrupar por»: cuántas hay de cada valor, en vez de la lista. */
  groups: GroupCount[] | null;
  loadError: boolean;
  canManage: boolean;
  /** `data.export`: sin esto no se ofrece «Exportar CSV» (Equipo y roles, F24). */
  canExport?: boolean;
  timeZone: string;
}) {
  const url = useUrlFilters();
  const [exporting, startExport] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error" | "warning"; text: string } | null>(null);
  void canManage;

  const active =
    countMenuFilters(filters, dimensions) + (filters.q ? 1 : 0) + (filters.legacyRange ? 1 : 0) +
    (filters.period.period !== "historico" || filters.period.from ? 1 : 0);
  const showScore = formType === "survey";
  const columnDefs = useMemo(() => responseColumnDefs(columns), [columns]);
  const { visible: visibleDefs, toggle, showAll, reset } = useColumnPrefs(responseColumnsStorageKey(formId), columnDefs);

  function exportCsv() {
    setMessage(null);
    startExport(async () => {
      const params = Object.fromEntries(new URLSearchParams(url.search).entries());
      const result = await exportResponsesCsv({ formId, params });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage(
        result.truncated
          ? { tone: "warning", text: `El archivo tiene las primeras ${result.rows} respuestas. Filtrá por fecha para exportar el resto.` }
          : { tone: "success", text: `Exportadas ${result.rows} respuestas` },
      );
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {/* Todo en una fila: buscar, fecha, filtros y agrupar a la izquierda; columnas y exportar a la derecha. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ResponsesToolbarFilters
            filters={filters}
            dimensions={dimensions}
            facets={facets}
            search={url.search}
            pending={url.pending}
            onParams={url.setParams}
          />
          {url.pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Cargando" />}
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {total === baseTotal ? `${total} ${total === 1 ? "respuesta" : "respuestas"}` : `${total} de ${baseTotal} respuestas`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {!groups && (
              <div className="hidden md:block">
                <ColumnsMenu defs={columnDefs} groups={RESPONSE_COLUMN_GROUPS} visible={visibleDefs} onToggle={toggle} onShowAll={showAll} onReset={reset} />
              </div>
            )}
            {/* Exportar es `canExport` (equipo y roles, M2): quien no puede, no ve el boton. */}
            {canExport && (
              <button type="button" onClick={exportCsv} disabled={exporting || total === 0} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input px-2.5 text-[13px] font-medium hover:bg-accent disabled:opacity-50">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}
                Exportar CSV
              </button>
            )}
          </div>
        </div>

        <ResponsesFilterChips filters={filters} dimensions={dimensions} onParams={url.setParams} />

        {message && (
          <div className="mb-3" role="status">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
        {loadError && <div className="mb-3"><Notice tone="error">No pudimos cargar las respuestas. Probá de nuevo.</Notice></div>}
        {truncated && (
          <div className="mb-3">
            <Notice tone="warning">Hay más de 10.000 respuestas en este período: se cuentan y se muestran las más nuevas. Acortá la fecha para ver el resto.</Notice>
          </div>
        )}

        {groups && filters.groupBy ? (
          groups.length === 0 ? (
            <EmptyState active={active} formId={formId} />
          ) : (
            <ResponseGroups
              groups={groups}
              dimensionLabel={DIMENSION_LABELS[filters.groupBy]}
              onSelect={(g) => url.setParams(selectGroup(filters.groupBy!, g.value))}
            />
          )
        ) : rows.length === 0 ? (
          <EmptyState active={active} formId={formId} />
        ) : (
          <>
            {/* Tabla (pantallas anchas) */}
            <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
                    {/* Fijo al desplazar: con tantas columnas, si no se pierde de quién es cada fila. */}
                    <th scope="col" className="sticky left-0 z-10 border-r border-border bg-muted px-3 py-2 font-medium">Contacto</th>
                    <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                    {showScore && <th scope="col" className="px-3 py-2 font-medium">Puntaje</th>}
                    {visibleDefs.map((def) => (
                      <th key={def.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 font-medium", def.removed && "italic")} title={def.hint}>
                        {def.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="group hover:bg-muted/30">
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link href={`/dashboard/formularios/${formId}/respuestas/${row.id}`} className="underline-offset-2 hover:underline">
                          {formatInZone(row.createdAt, timeZone)}
                        </Link>
                      </td>
                      <td className="sticky left-0 z-10 max-w-[14rem] truncate border-r border-border bg-background px-3 py-2 group-hover:bg-[color-mix(in_oklab,var(--muted)_30%,var(--background))]">
                        {row.contactId ? (
                          <Link href={`/dashboard/contacts/${row.contactId}`} className="underline-offset-2 hover:underline">
                            {row.contactName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Sin contacto</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]", STATUS_STYLE[row.status])}>{statusLabel(row.status)}</span>
                      </td>
                      {showScore && <td className="px-3 py-2">{row.score ?? "—"}</td>}
                      {visibleDefs.map((def) => (
                        <ColumnCell key={def.key} def={def} row={row} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas (celular) */}
            <ul className="space-y-2 md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link href={`/dashboard/formularios/${formId}/respuestas/${row.id}`} className="block rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{formatInZone(row.createdAt, timeZone)}</span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", STATUS_STYLE[row.status])}>{statusLabel(row.status)}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium">{row.contactName ?? "Sin contacto"}</p>
                    {columns.slice(0, 2).map((c) => (
                      <p key={c.key} className="truncate text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.label}:</span> {cellFor(row, c) || "—"}
                      </p>
                    ))}
                    {originSummary(row.attribution) && (
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Origen:</span> {originSummary(row.attribution)}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {!groups && (
          <div className="mt-4">
            <Pagination page={page} total={total} pageSize={pageSize} onPage={url.setPage} />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ active, formId }: { active: number; formId: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground/40" aria-hidden />
      <p className="mt-3 text-sm font-medium">{active > 0 ? "Nada coincide con estos filtros" : "Todavía no hay respuestas"}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {active > 0 ? (
          "Probá con otro período o quitá algún filtro."
        ) : (
          <>
            Compartí el link desde{" "}
            <Link href={`/dashboard/formularios/${formId}?tab=publicar`} className="underline">
              Publicar
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}
