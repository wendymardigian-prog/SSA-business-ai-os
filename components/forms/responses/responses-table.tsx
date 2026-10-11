"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, Download, Inbox, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/forms/back-link";
import { Notice } from "@/components/agents/fields";
import { FilterBar, FilterSelect, Pagination, useUrlFilters } from "@/components/agents/filters";
import { exportResponsesCsv } from "@/lib/actions/forms/responses";
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
}

const STATUS_STYLE: Record<SubmissionStatus, string> = {
  received: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  no_contact: "border-border text-muted-foreground",
  spam: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

export function ResponsesTable({
  formId,
  formName,
  formType,
  rows,
  columns,
  total,
  page,
  pageSize,
  filters,
  loadError,
  canManage,
  timeZone,
}: {
  formId: string;
  formName: string;
  formType: "custom" | "survey" | "contract";
  rows: ResponseTableRow[];
  columns: ResponseColumn[];
  total: number;
  page: number;
  pageSize: number;
  filters: { from: string; to: string; status: string; contact: string };
  loadError: boolean;
  canManage: boolean;
  timeZone: string;
}) {
  const url = useUrlFilters();
  const [exporting, startExport] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error" | "warning"; text: string } | null>(null);
  void canManage;

  const active = [filters.from, filters.to, filters.status !== "all" ? filters.status : "", filters.contact !== "all" ? filters.contact : ""].filter(Boolean).length;
  const showScore = formType === "survey";

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
      <PageHeader
        title="Respuestas"
        tooltip="Lo que respondió la gente. Solo ves las respuestas de los contactos que podés ver."
        backHref={<BackLink href={`/dashboard/formularios/${formId}`} label="Volver al formulario" />}
        right={
          <button type="button" onClick={exportCsv} disabled={exporting || total === 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent disabled:opacity-50">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <Link href={`/dashboard/formularios/${formId}`} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> {formName}
        </Link>

        {message && (
          <div className="mb-3" role="status">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
        {loadError && <div className="mb-3"><Notice tone="error">No pudimos cargar las respuestas. Probá de nuevo.</Notice></div>}

        <div className="mb-4">
          <FilterBar activeCount={active} onClear={() => url.clearAll([])} pending={url.pending}>
            <input type="date" aria-label="Desde" value={filters.from} onChange={(e) => url.setParam("desde", e.target.value)} className="rounded-lg border border-input bg-background px-2 py-2 text-sm" />
            <span className="text-xs text-muted-foreground">a</span>
            <input type="date" aria-label="Hasta" value={filters.to} onChange={(e) => url.setParam("hasta", e.target.value)} className="rounded-lg border border-input bg-background px-2 py-2 text-sm" />
            <FilterSelect
              label="Estado"
              value={filters.status === "all" ? "" : filters.status}
              onChange={(v) => url.setParam("estado", v)}
              options={[
                { value: "received", label: "Recibida" },
                { value: "no_contact", label: "Sin contacto" },
                { value: "spam", label: "Spam" },
              ]}
            />
            <FilterSelect
              label="Contacto"
              value={filters.contact === "with" ? "con" : filters.contact === "without" ? "sin" : ""}
              onChange={(v) => url.setParam("contacto", v)}
              options={[
                { value: "con", label: "Con contacto" },
                { value: "sin", label: "Sin contacto" },
              ]}
            />
          </FilterBar>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground/40" aria-hidden />
            <p className="mt-3 text-sm font-medium">{active > 0 ? "Nada coincide con estos filtros" : "Todavía no hay respuestas"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {active > 0 ? (
                "Probá con otro período o quitá algún filtro."
              ) : (
                <>
                  Compartí el link desde{" "}
                  <Link href={`/dashboard/formularios/${formId}`} className="underline">
                    Publicar
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
        ) : (
          <>
            {/* Tabla (pantallas anchas) */}
            <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
                    <th scope="col" className="px-3 py-2 font-medium">Contacto</th>
                    <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                    {showScore && <th scope="col" className="px-3 py-2 font-medium">Puntaje</th>}
                    {columns.map((c) => (
                      <th key={c.key} scope="col" className={cn("px-3 py-2 font-medium", c.removed && "italic")} title={c.removed ? "Este campo ya no está en el formulario" : undefined}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link href={`/dashboard/formularios/${formId}/respuestas/${row.id}`} className="underline-offset-2 hover:underline">
                          {formatInZone(row.createdAt, timeZone)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {row.contactId ? (
                          <Link href={`/dashboard/contacts/${row.contactId}`} className="underline-offset-2 hover:underline">
                            {row.contactName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Sin contacto</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", STATUS_STYLE[row.status])}>{statusLabel(row.status)}</span>
                      </td>
                      {showScore && <td className="px-3 py-2">{row.score ?? "—"}</td>}
                      {columns.map((c) => (
                        <td key={c.key} className="max-w-[16rem] truncate px-3 py-2" title={cellFor(row, c)}>
                          {cellFor(row, c) || <span className="text-muted-foreground">—</span>}
                        </td>
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
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-4">
          <Pagination page={page} total={total} pageSize={pageSize} onPage={url.setPage} />
        </div>
      </div>
    </div>
  );
}
