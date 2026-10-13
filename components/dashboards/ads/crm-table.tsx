"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart2, Download } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { buildCrmRows, countByStatus, filterByStatus, totalRow, type CrmLevel, type CrmRow, type StatusFilter } from "@/lib/dashboards/ads-crm";
import { GROUP_LABEL, GROUP_ORDER, GROUP_TIP, formatCell, type ColumnDef, type ColumnGroup } from "@/lib/dashboards/ads-crm-columns";
import { visibleColumns } from "@/lib/dashboards/ads-columns";
import { csvFilename, toCsv } from "@/lib/dashboards/ads-crm-csv";
import type { CrmTableData } from "@/lib/dashboards/ads-crm-load";
import type { AdsRow, AdsTotals } from "@/lib/dashboards/ads";
import { ColumnsMenu } from "./columns-menu";
import { useColumnPrefs } from "./use-column-prefs";
import { StatusDot } from "./status-dot";

/**
 * La tabla «Meta vs CRM» de una pestaña (campañas, conjuntos o anuncios): lo que dice Meta, lo que dicen los dos
 * y lo que paso en el CRM, en tres grupos de color. Todas las cuentas salen de `lib/dashboards/ads-crm.ts` y las
 * columnas de `ads-crm-columns.ts`; esto solo las dibuja.
 *
 * - Un clic en una fila lleva al detalle del objeto (igual que antes).
 * - La primera columna queda fija al desplazarse de costado; la pagina nunca hace scroll horizontal.
 * - El total suma lo sumable y calcula los cocientes sobre los totales.
 */

const FIRST_LABEL: Record<CrmLevel, string> = { campaign: "Campaña", adset: "Ad Set", ad: "Anuncio" };
const EMPTY_LABEL: Record<CrmLevel, string> = {
  campaign: "Sin campañas en este período",
  adset: "Sin ad sets en este período",
  ad: "Sin anuncios en este período",
};

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "paused", label: "Pausados" },
];

// Cada grupo tiene su color en un borde y un fondo suave; el texto usa los tokens del tema (claro y oscuro).
const GROUP_STYLE: Record<ColumnGroup, { head: string; cell: string }> = {
  meta: { head: "border-t-2 border-sky-500 bg-sky-500/10", cell: "" },
  metaVsCrm: { head: "border-t-2 border-amber-500 bg-amber-500/10", cell: "bg-amber-500/[0.04]" },
  crm: { head: "border-t-2 border-emerald-500 bg-emerald-500/10", cell: "" },
};

const TD = "px-2 py-2 text-right text-foreground whitespace-nowrap";

function ColumnHeader({ column }: { column: ColumnDef }) {
  return (
    <th scope="col" className="whitespace-nowrap px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
      <Tip
        align="center"
        content={
          <>
            <p className="mb-1 font-semibold text-foreground">{column.tip.title}</p>
            <p className="text-muted-foreground">{column.tip.body}</p>
          </>
        }
      >
        <span tabIndex={0} className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {column.label}
        </span>
      </Tip>
    </th>
  );
}

function FirstCell({ row, level }: { row: CrmRow; level: CrmLevel }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {level === "ad" && (
        // La miniatura es una URL firmada de Storage con vencimiento: next/image no la puede optimizar. Carga lazy.
        row.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage con vencimiento.
          <img src={row.thumbnailUrl} alt="" title={row.creativeTitle ?? undefined} loading="lazy" className="h-9 w-9 shrink-0 rounded-md border border-border object-cover" />
        ) : (
          <span className="h-9 w-9 shrink-0 rounded-md border border-dashed border-border" aria-hidden title={row.creativeTitle ?? "Sin miniatura todavía"} />
        )
      )}
      <div className="min-w-0">
        <p className="max-w-[170px] truncate font-medium text-foreground sm:max-w-[240px]" title={row.name ?? row.objectId}>
          {row.name || row.objectId}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <StatusDot status={row.effectiveStatus} />
          {row.parentName && <span className="max-w-[120px] truncate" title={row.parentName}>· {row.parentName}</span>}
        </div>
      </div>
    </div>
  );
}

export function CrmLevelTable({
  level,
  rows,
  totals,
  crm,
  currency,
  hrefOf,
}: {
  level: CrmLevel;
  /** Las filas de metricas del periodo (todos los niveles). */
  rows: AdsRow[];
  /** Los totales de la cuenta (con el alcance unico real). */
  totals: AdsTotals;
  crm: CrmTableData;
  currency: string | null;
  hrefOf: (objectId: string) => string;
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useColumnPrefs(level);
  const [filter, setFilter] = useState<StatusFilter>("all");

  const all = useMemo(
    () => buildCrmRows({ rows, level, metrics: crm.metrics[level], catalog: crm.catalog[level] }),
    [rows, level, crm.metrics, crm.catalog],
  );
  const shown = useMemo(() => filterByStatus(all, filter), [all, filter]);
  const counts = useMemo(() => countByStatus(all), [all]);
  // El alcance unico de la cuenta solo corresponde al total cuando se ven todos los objetos.
  const total = useMemo(() => totalRow(shown, filter === "all" ? totals.reach : null), [shown, filter, totals.reach]);

  const columns = visibleColumns(prefs);
  const groups = GROUP_ORDER.map((group) => ({ group, columns: columns.filter((c) => c.group === group) })).filter((g) => g.columns.length > 0);

  const exportCsv = () => {
    const csv = toCsv({ firstColumnLabel: FIRST_LABEL[level], columns, rows: shown, total });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename(level, crm.since, crm.until);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Estado" className="inline-flex rounded-lg border border-border p-0.5 text-xs">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label} · {counts[value]}
            </button>
          ))}
        </div>

        {crm.unmatchedCount > 0 && (
          <Link href="/dashboard/dashboards/ads/sin-vincular" className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/20">
            {crm.unmatchedCount} sin vincular
          </Link>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={shown.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Exportar CSV</span>
            <span className="sr-only sm:hidden">Exportar CSV</span>
          </button>
          <ColumnsMenu prefs={prefs} onChange={setPrefs} />
        </div>
      </div>

      {crm.error && (
        <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          No pude leer los datos del CRM, así que se muestra solo lo que dice Meta. Probá de nuevo en un rato.
        </p>
      )}
      {crm.scopeLimited && <p className="text-xs text-muted-foreground">Ves los leads, agendas y ventas de tu alcance.</p>}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-40" aria-hidden />
          {all.length === 0 ? EMPTY_LABEL[level] : "No hay objetos con ese estado en este período"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-card" />
                {groups.map(({ group, columns: cols }) => (
                  <th key={group} colSpan={cols.length} scope="colgroup" className={`px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-foreground ${GROUP_STYLE[group].head}`}>
                    <Tip align="start" content={<p className="text-muted-foreground">{GROUP_TIP[group]}</p>}>
                      <span tabIndex={0} className="cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{GROUP_LABEL[group]}</span>
                    </Tip>
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border">
                <th scope="col" className="sticky left-0 z-10 bg-card px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {FIRST_LABEL[level]}
                </th>
                {columns.map((column) => (
                  <ColumnHeader key={column.id} column={column} />
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.objectId} onClick={() => router.push(hrefOf(row.objectId))} className="group cursor-pointer border-b border-border/50 hover:bg-muted/30">
                  <td className="sticky left-0 z-[1] bg-card px-2 py-2 group-hover:bg-muted">
                    <Link href={hrefOf(row.objectId)} onClick={(e) => e.stopPropagation()} className="block hover:underline">
                      <FirstCell row={row} level={level} />
                    </Link>
                  </td>
                  {columns.map((column) => (
                    <td key={column.id} className={`${TD} ${GROUP_STYLE[column.group].cell}`}>
                      {formatCell(column, row, currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td className="sticky left-0 z-[1] bg-card px-2 py-2 text-foreground">Total</td>
                {columns.map((column) => (
                  <td key={column.id} className={`${TD} ${column.id === "spend" ? "text-primary" : ""}`}>
                    {formatCell(column, total, currency)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        El total suma las filas: un contacto que tocó dos anuncios cuenta en cada uno. Las agendas incluyen las canceladas (existieron y costaron);
        «Asistidas» muestra la calidad. Los cocientes dicen «—» cuando no se pueden calcular.
      </p>
    </div>
  );
}
